import { describe, expect, it } from "vitest";
import { ChatHub, type ChatEventRow, type HubDeps } from "./chatHub";
import type { ChatEventPayload } from "./chat";

/** 事件表換成記憶體版;canAccess 看 access[userId] 裡有哪些對話。 */
function setup(options: { accessTtlMs?: number } = {}) {
  const state = {
    events: [] as ChatEventRow[],
    access: {} as Record<string, string[]>,
    accessChecks: 0,
    purges: 0,
    clock: 1_000_000,
    failNext: false,
  };
  let nextId = 1;
  const deps: HubDeps = {
    latestId: async () => state.events.reduce((m, e) => Math.max(m, e.id), 0),
    fetchSince: async (afterId, limit) => {
      if (state.failNext) {
        state.failNext = false;
        throw new Error("db down");
      }
      return state.events.filter((e) => e.id > afterId).slice(0, limit);
    },
    canAccess: async (actor, _kind, id) => {
      state.accessChecks++;
      return (state.access[actor.userId] ?? []).includes(id);
    },
    purge: async () => {
      state.purges++;
    },
  };
  const errors: unknown[] = [];
  const hub = new ChatHub(deps, { pollMs: 10_000, now: () => state.clock, onError: (e) => errors.push(e), ...options });
  const publish = (type: string, conversationId: string, userId: string | null = null, messageId: string | null = null) => {
    state.events.push({ id: nextId++, type, conversationId, userId, messageId });
  };
  const listen = async (userId: string, role: "ADMIN" | "SUPERVISOR" | "MEMBER" = "MEMBER") => {
    const got: ChatEventPayload[] = [];
    const unsubscribe = await hub.subscribe({ userId, role }, (p) => got.push(p));
    return { got, unsubscribe };
  };
  return { state, hub, publish, listen, errors };
}

describe("ChatHub", () => {
  it("pushes a new event to the connections that may see that conversation, and only those", async () => {
    const { state, hub, publish, listen } = setup();
    state.access = { alice: ["c1"], bob: ["c1"], carol: ["c2"] };
    const alice = await listen("alice");
    const bob = await listen("bob");
    const carol = await listen("carol");

    publish("message", "c1", "alice", "m1");
    await hub.poll();

    expect(alice.got).toEqual([{ type: "message", c: "c1", u: "alice", m: "m1" }]);
    expect(bob.got).toHaveLength(1);
    expect(carol.got).toEqual([]);
    await Promise.all([alice, bob, carol].map((l) => l.unsubscribe()));
  });

  it("pushes an item-comment event only to those who may open that item, never mixing it up with a conversation of the same id", async () => {
    const { state, hub, publish, listen } = setup();
    state.access = { alice: ["item1"], bob: [] };
    const alice = await listen("alice");
    const bob = await listen("bob");
    publish("comment", "item1", "carol", "cm1");
    await hub.poll();
    expect(alice.got).toEqual([{ type: "comment", c: "item1", u: "carol", m: "cm1" }]);
    expect(bob.got).toEqual([]);
    await Promise.all([alice.unsubscribe(), bob.unsubscribe()]);
  });

  it("does not replay events from before the connection opened", async () => {
    const { state, hub, publish, listen } = setup();
    state.access = { alice: ["c1"] };
    publish("message", "c1", "bob", "old");
    const alice = await listen("alice");
    await hub.poll();
    expect(alice.got).toEqual([]);
    publish("message", "c1", "bob", "new");
    await hub.poll();
    expect(alice.got.map((p) => p.m)).toEqual(["new"]);
    await alice.unsubscribe();
  });

  it("delivers a conversation-list event to the named person only, without any access check", async () => {
    const { state, hub, publish, listen } = setup();
    state.access = {};
    const alice = await listen("alice");
    const bob = await listen("bob");
    publish("conversation", "g1", "bob");
    await hub.poll();
    expect(alice.got).toEqual([]);
    expect(bob.got).toEqual([{ type: "conversation", c: "g1", u: "bob", m: null }]);
    expect(state.accessChecks).toBe(0);
    await Promise.all([alice.unsubscribe(), bob.unsubscribe()]);
  });

  it("remembers an access answer for a while instead of asking the database for every event", async () => {
    const { state, hub, publish, listen } = setup();
    state.access = { alice: ["c1"] };
    const alice = await listen("alice");
    for (let i = 0; i < 5; i++) publish("message", "c1", "bob", `m${i}`);
    await hub.poll();
    expect(alice.got).toHaveLength(5);
    expect(state.accessChecks).toBe(1);
    await alice.unsubscribe();
  });

  it("asks again once the remembered answer is old, so a removed member stops receiving", async () => {
    const { state, hub, publish, listen } = setup({ accessTtlMs: 30_000 });
    state.access = { alice: ["c1"] };
    const alice = await listen("alice");
    publish("message", "c1", "bob", "m1");
    await hub.poll();
    state.access = { alice: [] };
    state.clock += 31_000;
    publish("message", "c1", "bob", "m2");
    await hub.poll();
    expect(alice.got.map((p) => p.m)).toEqual(["m1"]);
    await alice.unsubscribe();
  });

  it("keeps polling after the database fails once", async () => {
    const { state, hub, publish, listen, errors } = setup();
    state.access = { alice: ["c1"] };
    const alice = await listen("alice");
    publish("message", "c1", "bob", "m1");
    state.failNext = true;
    await hub.poll();
    expect(errors).toHaveLength(1);
    expect(alice.got).toEqual([]);
    await hub.poll();
    expect(alice.got.map((p) => p.m)).toEqual(["m1"]);
    await alice.unsubscribe();
  });

  it("stops polling when the last connection leaves, and starts from the present when the next arrives", async () => {
    const { state, hub, publish, listen } = setup();
    state.access = { alice: ["c1"] };
    const first = await listen("alice");
    expect(hub.connections).toBe(1);
    first.unsubscribe();
    expect(hub.connections).toBe(0);

    publish("message", "c1", "bob", "while-nobody-listened");
    const second = await listen("alice");
    await hub.poll();
    expect(second.got).toEqual([]);
    second.unsubscribe();
  });

  it("purges old events now and then, not on every poll", async () => {
    const { state, hub, listen } = setup();
    const alice = await listen("alice");
    await hub.poll();
    await hub.poll();
    expect(state.purges).toBe(1);
    state.clock += 11 * 60_000;
    await hub.poll();
    expect(state.purges).toBe(2);
    alice.unsubscribe();
  });

  it("does not run two polls at once, and does one more round if asked meanwhile", async () => {
    const { state, hub, publish, listen } = setup();
    state.access = { alice: ["c1"] };
    const alice = await listen("alice");
    publish("message", "c1", "bob", "m1");
    const first = hub.poll();
    publish("message", "c1", "bob", "m2");
    const second = hub.poll();
    await Promise.all([first, second]);
    expect(alice.got.map((p) => p.m)).toEqual(["m1", "m2"]);
    alice.unsubscribe();
  });
});

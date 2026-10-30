import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  risk: null as null | Record<string, unknown>,
  conn: null as null | Record<string, unknown>,
  locals: [] as { id: string; name: string; email: string }[],
  updates: [] as unknown[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    riskEntry: {
      findUnique: vi.fn(async () => db.risk),
      update: vi.fn(async (args: unknown) => {
        db.updates.push(args);
        return {};
      }),
    },
    mantisConnection: { findUnique: vi.fn(async () => db.conn) },
    user: { findMany: vi.fn(async () => db.locals) },
  },
}));
vi.mock("@/lib/secretBox", () => ({ decryptSecret: () => "good-token" }));

import { pushMantisChanges } from "@/lib/mantisWriteBack";
import { defaultMapping } from "@/lib/mantisMapping";

type Call = { method: string; url: string; body: unknown };
const calls: Call[] = [];

/** 假的 Mantis:依序回應,並記下每個請求的方法、網址與送出的內容。 */
function stubMantis(responses: { status: number; body?: unknown }[]) {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: { method?: string; body?: string }) => {
      calls.push({ method: init.method ?? "GET", url: String(url), body: init.body ? JSON.parse(init.body) : undefined });
      const r = queue.shift() ?? { status: 500 };
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    })
  );
}

const issueAt = (updated: string, over: Record<string, unknown> = {}) => ({
  issues: [
    {
      id: 12,
      summary: "藍牙斷線",
      description: "重現步驟:略。",
      status: { id: 50, name: "assigned" },
      severity: { id: 50, name: "minor" },
      priority: { id: 30, name: "normal" },
      handler: { id: 4, name: "chen.ee", email: "chen.ee@example.com" },
      updated_at: updated,
      ...over,
    },
  ],
});
const T1 = "2026-10-20T10:00:00+08:00";
const T2 = "2026-10-21T09:30:00+08:00";

beforeEach(() => {
  calls.length = 0;
  db.updates.length = 0;
  db.locals = [];
  db.risk = { id: "r1", boardId: "b1", mantisId: 12, mantisUpdatedAt: new Date(T1), status: "MITIGATING" };
  db.conn = {
    boardId: "b1",
    baseUrl: "https://mantis-wb.test",
    tokenEnc: "x",
    issueItemId: "item1",
    users: [{ id: 3, name: "li.sw", realName: "李小明", email: "li.sw@example.com" }],
    mapping: { ...defaultMapping(), writeBack: { enabled: true, fields: ["status", "handler", "severity", "content"] } },
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("pushMantisChanges: when it refuses before calling Mantis", () => {
  it("says so when the row is not from Mantis, or the connection is gone, or write-back is off", async () => {
    db.risk = { ...db.risk, mantisId: null };
    expect(await pushMantisChanges("r1", { status: "CLOSED" })).toEqual({ error: expect.stringContaining("不是從 Mantis") });
    db.risk = { id: "r1", boardId: "b1", mantisId: 12, mantisUpdatedAt: null, status: "OPEN" };
    db.conn = null;
    expect(await pushMantisChanges("r1", { status: "CLOSED" })).toEqual({ error: expect.stringContaining("沒有 Mantis 連線") });
    db.conn = { boardId: "b1", baseUrl: "https://mantis-wb.test", tokenEnc: "x", users: [], mapping: null };
    expect(await pushMantisChanges("r1", { status: "CLOSED" })).toEqual({ error: expect.stringContaining("沒有開啟寫回") });
    expect(calls).toHaveLength(0);
  });
});

describe("pushMantisChanges", () => {
  it("does not write over a change someone else just made in Mantis", async () => {
    stubMantis([{ status: 200, body: issueAt(T2) }]);
    const result = await pushMantisChanges("r1", { status: "CLOSED" });
    expect(result).toEqual({ error: expect.stringContaining("被改過") });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    expect(db.updates).toHaveLength(0);
  });

  it("sends only what changed, then reads the issue back and updates the row from it", async () => {
    stubMantis([
      { status: 200, body: issueAt(T1) },
      { status: 200, body: {} },
      { status: 200, body: issueAt(T2, { status: { id: 80, name: "resolved" }, resolution: { id: 20, name: "fixed" } }) },
    ]);
    const result = await pushMantisChanges("r1", { status: "CLOSED" });
    expect(result).toMatchObject({ ok: true, wrote: true });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /api/rest/issues/12",
      "PATCH /api/rest/issues/12",
      "GET /api/rest/issues/12",
    ]);
    expect(calls[1].body).toEqual({ status: { id: 80, name: "resolved" }, resolution: { id: 20, name: "fixed" } });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      where: { id: "r1" },
      data: { status: "CLOSED", mantisStatus: "resolved", mantisStatusId: 80, mantisUpdatedAt: new Date(T2), itemId: "item1" },
    });
  });

  it("does not call PATCH when there is nothing to send, and leaves the row alone", async () => {
    stubMantis([{ status: 200, body: issueAt(T1) }]);
    expect(await pushMantisChanges("r1", { status: "MITIGATING" })).toEqual({ ok: true, wrote: false, summary: [] });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    expect(db.updates).toHaveLength(0);
  });

  it("keeps 待審核 locally when the status asked for is one Mantis has no equivalent for", async () => {
    stubMantis([{ status: 200, body: issueAt(T1) }]);
    expect(await pushMantisChanges("r1", { status: "PENDING_REVIEW" })).toEqual({ ok: true, wrote: false, summary: [] });
    expect(calls).toHaveLength(1);
  });

  it("returns Mantis's own reason when it rejects the change, and saves nothing", async () => {
    stubMantis([
      { status: 200, body: issueAt(T1) },
      { status: 400, body: { message: "Status change not allowed", localized: "不允許變更成這個狀態" } },
    ]);
    const result = await pushMantisChanges("r1", { status: "CLOSED" });
    expect(result).toEqual({ error: expect.stringContaining("不允許變更成這個狀態") });
    expect(result).toEqual({ error: expect.stringContaining("沒有存") });
    expect(db.updates).toHaveLength(0);
  });

  it("explains a refusal for lack of permission", async () => {
    stubMantis([{ status: 200, body: issueAt(T1) }, { status: 403, body: { message: "Access Denied" } }]);
    expect(await pushMantisChanges("r1", { title: "新標題" })).toEqual({ error: expect.stringContaining("沒有修改這一筆問題的權限") });
  });

  it("still succeeds when Mantis answers the PATCH with an empty body", async () => {
    stubMantis([{ status: 200, body: issueAt(T1) }, { status: 204 }, { status: 200, body: issueAt(T2, { summary: "新標題" }) }]);
    expect(await pushMantisChanges("r1", { title: "新標題" })).toMatchObject({ ok: true, wrote: true });
    expect(db.updates[0]).toMatchObject({ data: { title: "新標題" } });
  });

  it("reports success with a note when the write went through but the read-back failed", async () => {
    stubMantis([{ status: 200, body: issueAt(T1) }, { status: 200, body: {} }, { status: 500 }]);
    expect(await pushMantisChanges("r1", { title: "新標題" })).toMatchObject({ ok: true, wrote: true, note: expect.stringContaining("讀回") });
    expect(db.updates).toHaveLength(0);
  });

  it("gives a clear message when the issue is gone from Mantis", async () => {
    stubMantis([{ status: 200, body: { issues: [] } }]);
    expect(await pushMantisChanges("r1", { status: "CLOSED" })).toEqual({ error: expect.stringContaining("找不到這一筆問題") });
  });

  it("reads the handler back onto the right person even when Mantis sends no email — matched by name", async () => {
    db.locals = [{ id: "u-jason", name: "Jason Huang", email: "jason.huang@example.com" }];
    stubMantis([
      { status: 200, body: issueAt(T1) },
      { status: 200, body: {} },
      { status: 200, body: issueAt(T2, { handler: { id: 12, name: "Jason_Huang" } }) },
    ]);
    await pushMantisChanges("r1", { title: "新標題" });
    expect(db.updates[0]).toMatchObject({ data: { ownerId: "u-jason", mantisHandlerId: 12 } });
  });

  it("a hand-made mapping decides who the Mantis handler is, over any guess", async () => {
    db.locals = [
      { id: "u-jason", name: "Jason Huang", email: "jason.huang@example.com" },
      { id: "u-other", name: "別人", email: "other@example.com" },
    ];
    db.conn = { ...db.conn, mapping: { ...defaultMapping(), writeBack: { enabled: true, fields: ["content"] }, handlerOverrides: { "u-other": 12 } } };
    stubMantis([
      { status: 200, body: issueAt(T1) },
      { status: 200, body: {} },
      { status: 200, body: issueAt(T2, { handler: { id: 12, name: "Jason_Huang" } }) },
    ]);
    await pushMantisChanges("r1", { title: "新標題" });
    expect(db.updates[0]).toMatchObject({ data: { ownerId: "u-other" } });
  });

  it("assigns by email: a Mantis user matching the person is sent as the handler", async () => {
    db.locals = [{ id: "u-li", name: "李小明", email: "li.sw@example.com" }];
    stubMantis([
      { status: 200, body: issueAt(T1) },
      { status: 200, body: {} },
      { status: 200, body: issueAt(T2, { handler: { id: 3, name: "li.sw", email: "li.sw@example.com" } }) },
    ]);
    const result = await pushMantisChanges("r1", { owner: { id: "u-li", name: "李小明", email: "Li.SW@example.com" } });
    expect(result).toMatchObject({ ok: true, wrote: true });
    expect(calls[1].body).toEqual({ handler: { id: 3 } });
    expect(db.updates[0]).toMatchObject({ data: { ownerId: "u-li", mantisHandlerId: 3 } });
  });
});

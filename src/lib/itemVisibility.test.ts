import { describe, expect, it } from "vitest";
import {
  computeVisibleItemIds,
  canSeeGroup,
  canManageVisibility,
  type VisibilityItem,
  type VisibilityNode,
} from "./itemVisibility";

const publicGroup: VisibilityNode = { id: "g1", visibility: "PUBLIC", viewerIds: [], createdById: null };

function item(
  id: string,
  overrides: Partial<VisibilityItem> = {}
): VisibilityItem {
  return {
    id,
    visibility: "PUBLIC",
    viewerIds: [],
    createdById: "owner",
    parentId: null,
    groupId: "g1",
    assigneeIds: [],
    ...overrides,
  };
}

const other = { userId: "outsider", isAdmin: false };
const owner = { userId: "owner", isAdmin: false };
const admin = { userId: "admin", isAdmin: true };

describe("computeVisibleItemIds", () => {
  it("shows public work to everyone", () => {
    const ids = computeVisibleItemIds([item("a")], [publicGroup], other);
    expect([...ids]).toEqual(["a"]);
  });

  it("hides a private item from another department", () => {
    const items = [item("a", { visibility: "PRIVATE" }), item("b")];
    expect([...computeVisibleItemIds(items, [publicGroup], other)]).toEqual(["b"]);
  });

  it("still shows it to its creator", () => {
    const items = [item("a", { visibility: "PRIVATE" })];
    expect([...computeVisibleItemIds(items, [publicGroup], owner)]).toEqual(["a"]);
  });

  it("shows it to someone explicitly named", () => {
    const items = [item("a", { visibility: "PRIVATE", viewerIds: ["outsider"] })];
    expect([...computeVisibleItemIds(items, [publicGroup], other)]).toEqual(["a"]);
  });

  it("shows it to whoever it is assigned to — you cannot do what you cannot see", () => {
    const items = [item("a", { visibility: "PRIVATE", assigneeIds: ["outsider"] })];
    expect([...computeVisibleItemIds(items, [publicGroup], other)]).toEqual(["a"]);
  });

  it("shows everything to an ADMIN", () => {
    const items = [item("a", { visibility: "PRIVATE" })];
    expect([...computeVisibleItemIds(items, [publicGroup], admin)]).toEqual(["a"]);
  });

  it("hides a public subtask of a private task", () => {
    const items = [item("parent", { visibility: "PRIVATE" }), item("child", { parentId: "parent" })];
    expect([...computeVisibleItemIds(items, [publicGroup], other)]).toEqual([]);
  });

  it("hides everything in a private group, however public the items are", () => {
    const secret: VisibilityNode = { id: "g2", visibility: "PRIVATE", viewerIds: [], createdById: "owner" };
    const items = [item("a", { groupId: "g2" }), item("b")];
    expect([...computeVisibleItemIds(items, [publicGroup, secret], other)]).toEqual(["b"]);
  });

  it("lets a named viewer into a private group", () => {
    const secret: VisibilityNode = { id: "g2", visibility: "PRIVATE", viewerIds: ["outsider"], createdById: "owner" };
    const items = [item("a", { groupId: "g2" })];
    expect([...computeVisibleItemIds(items, [secret], other)]).toEqual(["a"]);
  });

  it("treats a looping parent chain as hidden rather than hanging", () => {
    const items = [item("x", { parentId: "y" }), item("y", { parentId: "x" })];
    expect([...computeVisibleItemIds(items, [publicGroup], other)]).toEqual([]);
  });
});

describe("canSeeGroup", () => {
  it("keeps a private group off an outsider's board entirely", () => {
    const secret: VisibilityNode = { id: "g2", visibility: "PRIVATE", viewerIds: [], createdById: "owner" };
    expect(canSeeGroup(secret, other)).toBe(false);
    expect(canSeeGroup(secret, owner)).toBe(true);
    expect(canSeeGroup(secret, admin)).toBe(true);
  });
});

describe("canManageVisibility", () => {
  it("is the owner's decision, and an ADMIN's", () => {
    const node: VisibilityNode = { id: "a", visibility: "PRIVATE", viewerIds: ["outsider"], createdById: "owner" };
    expect(canManageVisibility(node, owner)).toBe(true);
    expect(canManageVisibility(node, admin)).toBe(true);
    // Being allowed to read it is not being allowed to re-share it.
    expect(canManageVisibility(node, other)).toBe(false);
  });
});

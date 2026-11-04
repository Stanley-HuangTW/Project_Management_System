import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/jwt";

/**
 * JWT 裡的 role 只是登入當下的快照;getSession 要用資料庫現在的角色蓋掉它,
 * 不然管理者把人升/降權之後,對方要重新登入才會生效(選單不見、或該擋的沒擋)。
 */

type Role = "ADMIN" | "SUPERVISOR" | "MEMBER";
const state = {
  cookie: undefined as string | undefined,
  /** 資料庫裡的使用者;沒有這個 id 就代表帳號已被刪除 */
  users: new Map<string, { role: Role }>(),
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "session" && state.cookie ? { value: state.cookie } : undefined),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => state.users.get(where.id) ?? null,
    },
  },
}));

import { getSession, requireSession } from "@/lib/session";

async function loginAs(userId: string, roleInToken: Role, extra: Record<string, string> = {}) {
  state.cookie = await createSessionToken({
    userId,
    email: `${userId}@example.com`,
    name: userId,
    role: roleInToken,
    ...extra,
  });
}

beforeEach(() => {
  state.cookie = undefined;
  state.users = new Map();
});

describe("getSession", () => {
  it("沒有 cookie → null", async () => {
    expect(await getSession()).toBeNull();
  });

  it("cookie 簽章不對 → null", async () => {
    state.cookie = "not-a-jwt";
    expect(await getSession()).toBeNull();
  });

  it("登入後被升成 ADMIN:拿到的是資料庫現在的 ADMIN,不是 token 裡的 SUPERVISOR", async () => {
    state.users.set("u1", { role: "ADMIN" });
    await loginAs("u1", "SUPERVISOR");
    expect((await getSession())?.role).toBe("ADMIN");
  });

  it("登入後被降成 MEMBER:舊 token 不能繼續當 ADMIN 用", async () => {
    state.users.set("u1", { role: "MEMBER" });
    await loginAs("u1", "ADMIN");
    expect((await getSession())?.role).toBe("MEMBER");
  });

  it("帳號已被刪除 → null(requireSession 會導回登入頁)", async () => {
    await loginAs("ghost", "ADMIN");
    expect(await getSession()).toBeNull();
    await expect(requireSession()).rejects.toThrow("REDIRECT:/login");
  });

  it("其他欄位照 token 原樣帶出,包含代操作的 impersonator", async () => {
    state.users.set("target", { role: "MEMBER" });
    await loginAs("target", "MEMBER", { impersonatorId: "admin1", impersonatorName: "管理者" });
    const session = await getSession();
    expect(session).toMatchObject({
      userId: "target",
      email: "target@example.com",
      name: "target",
      role: "MEMBER",
      impersonatorId: "admin1",
      impersonatorName: "管理者",
    });
  });

  it("代操作中:角色是被檢視者「現在」的角色(跟畫面、權限都跟對方一樣一致)", async () => {
    state.users.set("target", { role: "SUPERVISOR" });
    await loginAs("target", "MEMBER", { impersonatorId: "admin1", impersonatorName: "管理者" });
    expect((await getSession())?.role).toBe("SUPERVISOR");
  });
});

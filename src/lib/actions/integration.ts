"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { generateApiKey, hashApiKey, apiKeyPrefix } from "@/lib/apiKey";
import { generateWebhookSecret, WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  ownerName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new UserError("權限不足:僅管理者可以管理 API 金鑰");
  return session;
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  await requireAdmin();
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    include: { owner: { select: { name: true } } },
  });
  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    ownerName: key.owner.name,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Creates a key and returns it in the clear — the only time it ever exists
 *  outside the caller's own hands. */
export async function createApiKey(name: string): Promise<{ error?: string; key?: string }> {
  const session = await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入金鑰名稱" };

  const key = generateApiKey();
  await prisma.apiKey.create({
    data: { name: trimmed, hashedKey: hashApiKey(key), prefix: apiKeyPrefix(key), ownerId: session.userId },
  });
  // 金鑰帶著擁有者的全部存取權,所以發出一把等於多開一個入口。
  // 只記前綴——完整金鑰只在建立當下顯示一次,稽核紀錄不該是它的第二個副本。
  await logAudit("ACCESS", session.userId, `建立 API 金鑰「${trimmed}」(${apiKeyPrefix(key)}…)`);
  revalidatePath("/settings");
  return { key };
}

export async function revokeApiKey(keyId: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const revoked = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { name: true, prefix: true },
  });
  await prisma.apiKey.delete({ where: { id: keyId } }).catch(() => {});
  await logAudit(
    "ACCESS",
    session.userId,
    `撤銷 API 金鑰「${revoked?.name ?? keyId}」(${revoked?.prefix ?? "?"}…)`
  );
  revalidatePath("/settings");
  return {};
}

export type WebhookRow = {
  id: string;
  boardId: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
  lastStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
};

export async function listWebhooks(boardId: string): Promise<WebhookRow[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const hooks = await prisma.webhook.findMany({ where: { boardId }, orderBy: { createdAt: "asc" } });
  return hooks.map((hook) => ({
    id: hook.id,
    boardId: hook.boardId,
    url: hook.url,
    events: hook.events,
    active: hook.active,
    secret: hook.secret,
    lastStatus: hook.lastStatus,
    lastError: hook.lastError,
    lastAttemptAt: hook.lastAttemptAt?.toISOString() ?? null,
  }));
}

export async function createWebhook(
  boardId: string,
  url: string,
  events: string[]
): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "權限不足:僅管理者可以設定 Webhook" };
  await requireBoardAccess(boardId, session);

  const trimmed = url.trim();
  // http:// is allowed on purpose — plenty of these point at something on
  // the factory network that has no certificate.
  if (!/^https?:\/\/.+/i.test(trimmed)) return { error: "請輸入 http:// 或 https:// 開頭的網址" };
  const chosen = events.filter((e): e is WebhookEvent => WEBHOOK_EVENTS.includes(e as WebhookEvent));
  if (chosen.length === 0) return { error: "請至少選一個事件" };

  await prisma.webhook.create({
    data: { boardId, url: trimmed, events: chosen, secret: generateWebhookSecret() },
  });
  // 一個 webhook 會把看板上的異動送到外部網址去,等於一條資料出口。
  await logAudit("ACCESS", session.userId, `建立 Webhook:${trimmed}(${chosen.join("、")})`, boardId);
  revalidatePath("/settings");
  return {};
}

export async function setWebhookActive(webhookId: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "權限不足" };
  const hook = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { url: true, boardId: true },
  });
  await prisma.webhook.update({ where: { id: webhookId }, data: { active } });
  await logAudit(
    "ACCESS",
    session.userId,
    `${active ? "啟用" : "停用"} Webhook:${hook?.url ?? webhookId}`,
    hook?.boardId
  );
  revalidatePath("/settings");
  return {};
}

export async function deleteWebhook(webhookId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "權限不足" };
  const doomed = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { url: true, boardId: true },
  });
  await prisma.webhook.delete({ where: { id: webhookId } }).catch(() => {});
  await logAudit("ACCESS", session.userId, `刪除 Webhook:${doomed?.url ?? webhookId}`, doomed?.boardId);
  revalidatePath("/settings");
  return {};
}

export type OAuthGrantRow = {
  clientRowId: string;
  clientName: string;
  clientId: string;
  /** 這個用戶端目前還有幾張沒過期也沒撤銷的權杖。 */
  activeTokens: number;
  lastUsedAt: string | null;
  authorizedAt: string;
};

/**
 * 我授權過哪些 OAuth 應用程式。
 *
 * 只列自己的:一個人撤銷不了別人的授權,那是別人跟那個應用程式之間的事。
 */
export async function listOAuthGrants(): Promise<OAuthGrantRow[]> {
  const session = await requireSession();
  const tokens = await prisma.oAuthToken.findMany({
    where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });

  const byClient = new Map<string, OAuthGrantRow>();
  for (const token of tokens) {
    const existing = byClient.get(token.clientId);
    if (existing) {
      existing.activeTokens += 1;
      if (token.lastUsedAt && (!existing.lastUsedAt || token.lastUsedAt.toISOString() > existing.lastUsedAt)) {
        existing.lastUsedAt = token.lastUsedAt.toISOString();
      }
      continue;
    }
    byClient.set(token.clientId, {
      clientRowId: token.clientId,
      clientName: token.client.name,
      clientId: token.client.clientId,
      activeTokens: 1,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      authorizedAt: token.createdAt.toISOString(),
    });
  }
  return [...byClient.values()];
}

/** 撤銷我給某個應用程式的授權 —— 它手上所有權杖立刻失效。 */
export async function revokeOAuthGrant(clientRowId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const client = await prisma.oAuthClient.findUnique({ where: { id: clientRowId } });
  if (!client) return { error: "找不到這個應用程式" };

  // where 帶上 userId:撤的只會是自己那幾張,不會動到別人的。
  const result = await prisma.oAuthToken.updateMany({
    where: { clientId: clientRowId, userId: session.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.oAuthCode.deleteMany({ where: { clientId: clientRowId, userId: session.userId, usedAt: null } });

  await logAudit(
    "ACCESS",
    session.userId,
    `撤銷對「${client.name}」的 MCP 授權,${result.count} 張權杖失效`
  );
  return {};
}

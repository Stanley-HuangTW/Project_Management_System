"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { generateApiKey, hashApiKey, apiKeyPrefix } from "@/lib/apiKey";
import { generateWebhookSecret, WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks";
import { logAudit } from "@/lib/activityLog";

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
  if (session.role !== "ADMIN") throw new Error("權限不足:僅管理者可以管理 API 金鑰");
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

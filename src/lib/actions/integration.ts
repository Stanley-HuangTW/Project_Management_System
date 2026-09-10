"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { generateApiKey, hashApiKey, apiKeyPrefix } from "@/lib/apiKey";
import { generateWebhookSecret, WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks";

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
  revalidatePath("/settings");
  return { key };
}

export async function revokeApiKey(keyId: string): Promise<{ error?: string }> {
  await requireAdmin();
  await prisma.apiKey.delete({ where: { id: keyId } }).catch(() => {});
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
  revalidatePath("/settings");
  return {};
}

export async function setWebhookActive(webhookId: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "權限不足" };
  await prisma.webhook.update({ where: { id: webhookId }, data: { active } });
  revalidatePath("/settings");
  return {};
}

export async function deleteWebhook(webhookId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "權限不足" };
  await prisma.webhook.delete({ where: { id: webhookId } }).catch(() => {});
  revalidatePath("/settings");
  return {};
}

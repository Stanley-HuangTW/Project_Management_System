import { createHmac, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export const WEBHOOK_EVENTS = ["item.created", "item.updated", "item.deleted"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "item.created": "新增工作項",
  "item.updated": "工作項欄位變更",
  "item.deleted": "刪除工作項",
};

export function generateWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

/** The `X-Hrapp-Signature` header: HMAC-SHA256 of the exact body bytes. The
 *  receiver recomputes it to tell a real delivery from anyone who learned
 *  the URL. */
export function signWebhookBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Sends one event to every active webhook on a board.
 *
 * Never throws and never blocks the caller's own work: a customer's CI
 * server being down is not a reason for someone's cell edit to fail. Each
 * delivery gets a short timeout and its outcome is recorded on the webhook
 * row, which is where you look when an integration goes quiet.
 */
export async function dispatchWebhooks(
  boardId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  let hooks;
  try {
    hooks = await prisma.webhook.findMany({ where: { boardId, active: true, events: { has: event } } });
  } catch {
    return;
  }
  if (hooks.length === 0) return;

  const body = JSON.stringify({ event, boardId, sentAt: new Date().toISOString(), data: payload });

  await Promise.all(
    hooks.map(async (hook) => {
      let status: number | null = null;
      let error: string | null = null;
      try {
        const response = await fetch(hook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hrapp-event": event,
            "x-hrapp-signature": signWebhookBody(hook.secret, body),
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        status = response.status;
        if (!response.ok) error = `HTTP ${response.status}`;
      } catch (e) {
        error = e instanceof Error ? e.message : "傳送失敗";
      }
      await prisma.webhook
        .update({
          where: { id: hook.id },
          data: { lastStatus: status, lastError: error, lastAttemptAt: new Date() },
        })
        .catch(() => {});
    })
  );
}

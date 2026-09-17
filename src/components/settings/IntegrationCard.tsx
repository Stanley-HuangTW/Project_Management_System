"use client";

import { useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, type WebhookEvent } from "@/lib/webhooks";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listOAuthGrants,
  revokeOAuthGrant,
  listWebhooks,
  createWebhook,
  setWebhookActive,
  deleteWebhook,
  type ApiKeyRow,
  type WebhookRow,
  type OAuthGrantRow,
} from "@/lib/actions/integration";

/**
 * API 金鑰與 Webhook — the two halves of "對外整合": pull the data out, or
 * be told when it changes.
 */
export function IntegrationCard({ boards }: { boards: { id: string; name: string }[] }) {
  const { notify, confirm } = useDialogs();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [keyName, setKeyName] = useState("");
  /** Shown once, right after creation — it cannot be read back afterwards. */
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);
  const [grants, setGrants] = useState<OAuthGrantRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rows, grantRows] = await Promise.all([listApiKeys(), listOAuthGrants()]);
      if (!cancelled) {
        setKeys(rows);
        setGrants(grantRows);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    (async () => {
      const rows = await listWebhooks(boardId);
      if (!cancelled) setHooks(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function handleCreateKey() {
    setBusy(true);
    try {
      const result = await createApiKey(keyName);
      if (result.error) {
        await notify(result.error, { title: "無法建立金鑰" });
        return;
      }
      setFreshKey(result.key ?? null);
      setKeyName("");
      setKeys(await listApiKeys());
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(key: ApiKeyRow) {
    const ok = await confirm(`撤銷金鑰「${key.name}」?使用它的整合會立刻停止運作。`, {
      title: "撤銷 API 金鑰",
      confirmLabel: "撤銷",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await revokeApiKey(key.id);
      setKeys(await listApiKeys());
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateHook() {
    setBusy(true);
    try {
      const result = await createWebhook(boardId, url, events);
      if (result.error) {
        await notify(result.error, { title: "無法建立 Webhook" });
        return;
      }
      setUrl("");
      setHooks(await listWebhooks(boardId));
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500";

  return (
    <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">API / Webhook</h2>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        唯讀 REST API:<code className="rounded bg-neutral-100 dark:bg-neutral-800 px-1">GET /api/v1/boards</code>、
        <code className="rounded bg-neutral-100 dark:bg-neutral-800 px-1">GET /api/v1/boards/&lt;id&gt;/items</code>,
        以 <code className="rounded bg-neutral-100 dark:bg-neutral-800 px-1">Authorization: Bearer &lt;金鑰&gt;</code> 呼叫。
        金鑰沿用建立者的看板權限,看不到建立者本來就看不到的看板。
      </p>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={keyName}
            disabled={busy}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="金鑰用途,例如 ERP 同步"
            className={`${fieldClass} w-56`}
          />
          <button
            type="button"
            disabled={busy || !keyName.trim()}
            onClick={handleCreateKey}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} /> 建立金鑰
          </button>
        </div>

        {freshKey && (
          <div className="mt-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              這是這把金鑰唯一一次顯示,離開這個畫面就再也看不到了。
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white dark:bg-neutral-900 px-2 py-1 text-xs">
                {freshKey}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(freshKey)}
                className="flex items-center gap-1 rounded border border-amber-300 dark:border-amber-700 px-2 py-1 text-xs text-amber-800 dark:text-amber-200"
              >
                <Copy size={12} /> 複製
              </button>
              <button
                type="button"
                onClick={() => setFreshKey(null)}
                className="text-xs text-amber-700 dark:text-amber-300 hover:underline"
              >
                我已存好
              </button>
            </div>
          </div>
        )}

        <OAuthGrants
          grants={grants}
          busy={busy}
          onRevoke={async (grant) => {
            const ok = await confirm(
              `撤銷對「${grant.clientName}」的授權?它手上的權杖會立刻失效,下次要用得重新授權。`,
              { title: "撤銷 MCP 授權", confirmLabel: "撤銷", danger: true }
            );
            if (!ok) return;
            setBusy(true);
            try {
              const result = await revokeOAuthGrant(grant.clientRowId);
              if (result.error) {
                await notify(result.error, { title: "無法撤銷" });
                return;
              }
              setGrants(await listOAuthGrants());
            } finally {
              setBusy(false);
            }
          }}
        />

        {keys.length > 0 && (
          <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-700 rounded-md border border-neutral-200 dark:border-neutral-700">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-neutral-800 dark:text-neutral-100">{key.name}</span>
                  <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                    {key.prefix}…・{key.ownerName}・
                    {key.lastUsedAt ? `最後使用 ${new Date(key.lastUsedAt).toLocaleDateString("zh-TW")}` : "尚未使用"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRevoke(key)}
                  className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                  aria-label="撤銷金鑰"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 border-t border-neutral-100 dark:border-neutral-700 pt-4">
        <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Webhook</h3>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          工作項有變動時 POST 一份 JSON 到你的網址。每次傳送都會帶
          <code className="mx-1 rounded bg-neutral-100 dark:bg-neutral-800 px-1">X-Hrapp-Signature</code>
          (以該 Webhook 的密鑰對內容做 HMAC-SHA256),收端可以據此確認是本系統送的。
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={boardId} disabled={busy} onChange={(e) => setBoardId(e.target.value)} className={fieldClass}>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
          <input
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/hrapp"
            className={`${fieldClass} w-64`}
          />
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={(e) =>
                  setEvents(e.target.checked ? [...events, event] : events.filter((x) => x !== event))
                }
              />
              {WEBHOOK_EVENT_LABELS[event]}
            </label>
          ))}
          <button
            type="button"
            disabled={busy || !url.trim() || !boardId}
            onClick={handleCreateHook}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            新增
          </button>
        </div>

        {hooks.length > 0 && (
          <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-700 rounded-md border border-neutral-200 dark:border-neutral-700">
            {hooks.map((hook) => (
              <li key={hook.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-neutral-800 dark:text-neutral-100">{hook.url}</span>
                  <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                    {hook.events.map((e) => WEBHOOK_EVENT_LABELS[e as WebhookEvent] ?? e).join("、")}
                    {hook.lastAttemptAt && (
                      <>
                        ・最後傳送 {new Date(hook.lastAttemptAt).toLocaleString("zh-TW")}
                        <span className={hook.lastError ? "text-red-600" : "text-green-600"}>
                          {" "}
                          {hook.lastError ?? `HTTP ${hook.lastStatus}`}
                        </span>
                      </>
                    )}
                  </span>
                  <code className="mt-0.5 block truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    密鑰 {hook.secret}
                  </code>
                </span>
                <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <input
                    type="checkbox"
                    checked={hook.active}
                    disabled={busy}
                    onChange={async (e) => {
                      await setWebhookActive(hook.id, e.target.checked);
                      setHooks(await listWebhooks(boardId));
                    }}
                  />
                  啟用
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await deleteWebhook(hook.id);
                    setHooks(await listWebhooks(boardId));
                  }}
                  className="rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                  aria-label="刪除 Webhook"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * 我授權過的 MCP 應用程式。
 *
 * 同意畫面上寫著「可以隨時在系統設定撤銷」—— 那句話要有地方兌現,不然它
 * 只是一句讓人安心的話。
 */
function OAuthGrants({
  grants,
  busy,
  onRevoke,
}: {
  grants: OAuthGrantRow[];
  busy: boolean;
  onRevoke: (grant: OAuthGrantRow) => void;
}) {
  if (grants.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
        已授權的 MCP 應用程式
      </p>
      <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        這些應用程式以你的身分讀資料,看得到的範圍跟你自己登入時一樣。
      </p>
      <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
        {grants.map((grant) => (
          <li key={grant.clientRowId} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-neutral-800 dark:text-neutral-100">
                {grant.clientName}
              </span>
              <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                {grant.activeTokens} 張有效權杖・
                {grant.lastUsedAt
                  ? `最後使用 ${new Date(grant.lastUsedAt).toLocaleDateString("zh-TW")}`
                  : "尚未使用"}
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRevoke(grant)}
              className="rounded p-1 text-neutral-400 hover:text-red-600 disabled:opacity-50 dark:text-neutral-500"
              aria-label="撤銷授權"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

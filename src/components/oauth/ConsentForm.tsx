"use client";

import { useState } from "react";
import { approveAuthorization } from "@/lib/actions/oauth";

/**
 * 同意畫面。
 *
 * 把「會給出去什麼」寫清楚:權杖借用的是按下允許那個人的權限,所以該講的
 * 不是抽象的 scope,而是「它看得到的就跟你登入時一樣」。管理者還要多一句
 * 警告,因為 ADMIN 的權杖可以跑唯讀 SQL,那等於整個資料庫。
 */
export function ConsentForm({
  clientName,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  resource,
  userName,
  userRole,
  denyUrl,
}: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string | null;
  userName: string;
  userRole: "ADMIN" | "SUPERVISOR" | "MEMBER";
  denyUrl: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const result = await approveAuthorization({
        clientId,
        redirectUri,
        state,
        codeChallenge,
        resource,
      });
      if (result.error) {
        setError(result.error);
        setBusy(false);
        return;
      }
      window.location.href = result.redirectTo!;
    } catch {
      setError("授權失敗,請重試");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-800">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          授權「{clientName}」
        </h1>
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
          以 <span className="font-medium">{userName}</span> 的身分。
        </p>

        <div className="mb-4 space-y-2 rounded-md bg-neutral-50 p-3 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          <p className="font-medium">它會拿到什麼</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-600 dark:text-neutral-300">
            <li>讀取你看得到的看板、工作項、時程、預算與人力 —— 範圍跟你自己登入時完全一樣</li>
            <li>不會拿到你的密碼</li>
            <li>你可以隨時在「系統設定 → 整合」把它撤銷</li>
          </ul>
        </div>

        {userRole === "ADMIN" && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            你是管理者,所以這張權杖也能跑唯讀 SQL —— 那等於整個資料庫。只授權給你確定信得過的應用程式。
          </div>
        )}

        <p className="mb-4 break-all text-[11px] text-neutral-400 dark:text-neutral-500">
          完成後會導回:{redirectUri}
        </p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <a
            href={denyUrl}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-center text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            拒絕
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={approve}
            className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "處理中..." : "允許"}
          </button>
        </div>
      </div>
    </div>
  );
}

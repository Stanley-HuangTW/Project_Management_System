"use client";

import { useState } from "react";
import { stopImpersonation } from "@/lib/actions/impersonate";

/**
 * 管理者以別人的身分檢視時,整條釘在畫面最上方——最怕的是忘了自己正在代操作,
 * 所以用黃底、常駐、一鍵退出。是版面裡真的一列(把下面的內容往下推),不是浮在上面,免得蓋到標題與工具列。
 * 手機版左上角有一條固定的選單列,所以那時往下讓開(mt-12)。
 */
export function ImpersonationBanner({ name, adminName }: { name: string; adminName: string }) {
  const [busy, setBusy] = useState(false);

  async function exit() {
    setBusy(true);
    try {
      await stopImpersonation();
    } finally {
      window.location.reload();
    }
  }

  return (
    <div
      role="status"
      className="mt-12 flex shrink-0 items-center justify-center gap-3 bg-amber-400 px-4 py-1.5 text-xs font-medium text-neutral-900 md:mt-0"
    >
      <span className="min-w-0 truncate">
        正在以「{name}」的身分檢視(管理者 {adminName} 代操作,操作會記進稽核軌跡)
      </span>
      <button
        type="button"
        onClick={() => void exit()}
        disabled={busy}
        className="shrink-0 rounded bg-neutral-900 px-2 py-0.5 font-semibold text-white hover:bg-neutral-700 disabled:opacity-60"
      >
        {busy ? "退出中..." : "退出"}
      </button>
    </div>
  );
}

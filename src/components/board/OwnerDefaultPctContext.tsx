"use client";

import { createContext, useContext } from "react";

/**
 * 只掛在負責人欄位、沒有人員分配的工作項,算幾 % 的工作量(系統設定)。看板頁提供;在看板外面
 * 開出來的視窗(例如儀表板)沒有提供,就是 null,畫面只寫「預設」不寫數字。
 */
const OwnerDefaultPctContext = createContext<number | null>(null);

export const OwnerDefaultPctProvider = OwnerDefaultPctContext.Provider;

export function useOwnerDefaultPct(): number | null {
  return useContext(OwnerDefaultPctContext);
}

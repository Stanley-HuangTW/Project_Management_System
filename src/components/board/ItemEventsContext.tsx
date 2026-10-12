"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ItemDetailTab, ItemEventSummary } from "@/lib/itemEvents";

/** 表格要開哪個項目的哪一頁。nonce 每次遞增,同一個項目連點兩次也會再開一次。 */
export type OpenItemRequest = { itemId: string; tab: ItemDetailTab; nonce: number };

type ItemEventsValue = {
  /** 每個工作項的事件摘要。完成時間已經照「現在是不是完成狀態」處理過。 */
  summaries: Record<string, ItemEventSummary>;
  openRequest: OpenItemRequest | null;
  /** 在表格裡打開某個項目的視窗、跳到指定分頁——視窗是左邊「項目名稱」那一列的元件在管,資料欄那一列透過這裡請它開。 */
  requestOpen: (itemId: string, tab: ItemDetailTab) => void;
};

const Ctx = createContext<ItemEventsValue | null>(null);

/**
 * 「進行中時間」「完成時間」「更新記錄」三欄用的資料,加上點下去開項目視窗的請求。
 * 表格分成左右兩塊(項目名稱 / 資料欄)各自一組列元件,資料欄那邊的儲存格開不了視窗,所以走這個 context。
 */
export function ItemEventsProvider({
  summaries,
  children,
}: {
  summaries: Record<string, ItemEventSummary>;
  children: ReactNode;
}) {
  const [openRequest, setOpenRequest] = useState<OpenItemRequest | null>(null);
  const requestOpen = useCallback((itemId: string, tab: ItemDetailTab) => {
    setOpenRequest((prev) => ({ itemId, tab, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  const value = useMemo(() => ({ summaries, openRequest, requestOpen }), [summaries, openRequest, requestOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 不在表格裡(沒有 provider)就是 null,呼叫端當作沒有資料。 */
export function useItemEvents(): ItemEventsValue | null {
  return useContext(Ctx);
}

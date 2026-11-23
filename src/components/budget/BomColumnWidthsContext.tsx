"use client";

import { createContext, useContext } from "react";
import { colWidthStyle, type BomColWidths } from "@/lib/bomColumnWidths";

/**
 * 樣機 BOM 表的版面設定:使用者拖曳調整過的欄寬,以及固定在左邊的欄(勾選、名稱、BOM LEVEL)
 * 各自的 sticky left 位移。表頭(BomTable)與每一列的儲存格(BomRow、MoneyCells,還有遞迴的子列)
 * 都要套同一份,用 context 傳,不用把它穿過每一層的 props。
 */
export type BomLayout = {
  widths: BomColWidths;
  /** 名稱欄、BOM LEVEL 欄貼在左邊時的 left(px):前面幾欄(勾選、名稱)加起來的寬度。 */
  frozen: { name: number; level: number };
};

const Ctx = createContext<BomLayout>({ widths: {}, frozen: { name: 0, level: 0 } });

export const BomColumnWidthsProvider = Ctx.Provider;

/** 回傳「這一欄的樣式」的函式:沒調整過的欄回 undefined。 */
export function useBomColWidthStyle(): (key: string) => { width: number; minWidth: number } | undefined {
  const { widths } = useContext(Ctx);
  return (key) => colWidthStyle(widths, key);
}

export function useBomFrozenLeft(): BomLayout["frozen"] {
  return useContext(Ctx).frozen;
}

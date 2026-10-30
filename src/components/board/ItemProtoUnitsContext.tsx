"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/** 樣機計畫排出來的一台樣機,工作項「使用樣機」可以選的。 */
export type ProtoUnitOption = {
  id: string;
  product: string;
  unit: string;
  phaseId: string;
  phaseName: string;
  seq: number;
  /** 「M3 / EVT1 / SW #2」 */
  label: string;
};

export type ProtoUnitsData = {
  options: ProtoUnitOption[];
  /** 工作項 id → 它用到的樣機 id(只含看得到的工作項)。 */
  byItem: Record<string, string[]>;
};

const Ctx = createContext<ProtoUnitsData | null>(null);

/** 「使用樣機」欄用的資料。表格分成左右兩塊,資料欄的儲存格從這裡讀;null = 這裡沒有(視窗自己去讀,見 ItemProtoUnitsField)。 */
export function ItemProtoUnitsProvider({ data, children }: { data: ProtoUnitsData | null; children: ReactNode }) {
  const value = useMemo(() => data, [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useItemProtoUnits(): ProtoUnitsData | null {
  return useContext(Ctx);
}

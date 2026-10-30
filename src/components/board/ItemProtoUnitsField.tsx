"use client";

import { useCallback, useEffect, useState } from "react";
import { loadItemProtoUnits } from "@/lib/actions/itemProtoUnits";
import { ItemProtoUnitCell } from "./ItemProtoUnitCell";
import { ItemProtoUnitsProvider, useItemProtoUnits, type ProtoUnitsData } from "./ItemProtoUnitsContext";

/**
 * 項目卡片與人員分配視窗裡的「使用樣機」一列(跟表格最右邊那一欄是同一份資料、同一個選單)。
 * 在看板裡開視窗時,樣機資料已經由看板頁面給了;在儀表板這類看板以外的地方開,就自己向伺服器讀一次,
 * 存檔之後再讀一次。這個看板沒有排任何樣機、這個工作項也沒有用到時,整列不出現。
 */
export function ItemProtoUnitsField({
  itemId,
  canEdit,
  className,
  labelClassName,
}: {
  itemId: string;
  canEdit: boolean;
  /** 這一列外框的樣式(兩個視窗的版面不一樣)。 */
  className: string;
  /** 左邊「使用樣機」標籤的顏色(跟所在視窗其他欄位的標籤一致)。 */
  labelClassName: string;
}) {
  const fromBoard = useItemProtoUnits();
  const [fetched, setFetched] = useState<{ itemId: string; data: ProtoUnitsData } | null>(null);

  const load = useCallback(() => {
    loadItemProtoUnits(itemId)
      .then((data) => setFetched({ itemId, data }))
      .catch(() => setFetched(null));
  }, [itemId]);
  useEffect(() => {
    if (!fromBoard) load();
  }, [fromBoard, load]);

  const data = fromBoard ?? (fetched?.itemId === itemId ? fetched.data : null);
  if (!data || (data.options.length === 0 && (data.byItem[itemId] ?? []).length === 0)) return null;

  return (
    <ItemProtoUnitsProvider data={data}>
      <div className={className} data-card-field="使用樣機">
        <span className={`shrink-0 text-xs ${labelClassName}`}>使用樣機</span>
        {/* 樣機名字(產品 / 階段 / 用途 #第幾台)比一般欄位的值長,留寬一點。 */}
        <span className="w-56">
          <ItemProtoUnitCell itemId={itemId} canEdit={canEdit} bordered onSaved={fromBoard ? undefined : load} />
        </span>
      </div>
    </ItemProtoUnitsProvider>
  );
}

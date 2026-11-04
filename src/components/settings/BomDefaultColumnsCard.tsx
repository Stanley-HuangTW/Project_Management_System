"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";
import { BomColumnsDialog } from "@/components/budget/BomColumnsDialog";
import { resetBomDefaultColumns, saveBomDefaultColumns } from "@/lib/actions/systemSettings";
import { BOM_COLUMN_TYPE_LABELS, isMoneyBlock, type BomColumnDef } from "@/lib/bomColumns";

/**
 * BOM 預設欄位。
 *
 * 看板的樣機 BOM 有哪些欄位、什麼順序、哪些必填、新增時帶什麼預設值,在這裡設一份預設。
 * 還沒有自己設定過 BOM 欄位的看板都沿用這一份(這裡改了,它們立刻跟著變);
 * 看板自己改過(BOM 的「欄位設定」)就是它自己的,不受這裡影響。
 */
export function BomDefaultColumnsCard({ initialColumns, initialConfigured }: { initialColumns: BomColumnDef[]; initialConfigured: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const shown = initialColumns.filter((c) => !isMoneyBlock(c));
  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900" data-bom-default-columns-card>
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        <ListChecks size={14} /> BOM 預設欄位
      </p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        樣機 BOM 的欄位:除了名稱與金額(數量、單價、幣別、小計)之外,可以加自訂欄位(文字、數字、日期、下拉選單、人員、勾選、連結、檔案附件)、
        改名、隱藏、換順序、設必填與新增時的預設值。還沒有自己設定的看板都<b>沿用這一份</b>,這裡改了它們立刻跟著變;
        看板在 BOM 的「欄位設定」改過就是它自己的,不受這裡影響。
      </p>

      <div className="mb-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
        <p className="mb-1.5 text-xs text-neutral-400 dark:text-neutral-500">目前:{initialConfigured ? "自訂" : "內建欄位"}</p>
        <div className="flex flex-wrap gap-1">
          {shown.map((c) => (
            <span
              key={c.id}
              className={`rounded px-1.5 py-0.5 text-xs ${c.visible ? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200" : "bg-neutral-50 text-neutral-400 line-through dark:bg-neutral-800/50 dark:text-neutral-500"}`}
              title={`${BOM_COLUMN_TYPE_LABELS[c.type]}${c.required ? "、必填" : ""}${c.visible ? "" : "、隱藏"}`}
            >
              {c.name}
              {c.required && <span className="text-amber-600">*</span>}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        data-bom-default-columns-edit
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        編輯預設欄位
      </button>

      <BomColumnsDialog
        open={open}
        onOpenChange={setOpen}
        title="BOM 預設欄位"
        intro="沒有自己設定 BOM 欄位的看板都用這一份。"
        columns={initialColumns}
        onSave={async (columns) => {
          const result = await saveBomDefaultColumns(columns);
          if (!result.error) router.refresh();
          return result.error ?? null;
        }}
        onReset={
          initialConfigured
            ? async () => {
                const result = await resetBomDefaultColumns();
                if (!result.error) router.refresh();
                return result.error ?? null;
              }
            : undefined
        }
        resetLabel="恢復內建欄位"
      />
    </div>
  );
}

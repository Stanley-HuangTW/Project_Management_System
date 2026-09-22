import { requireSession } from "@/lib/session";
import { DataExportView } from "@/components/data-export/DataExportView";

export default async function DataExportPage() {
  const session = await requireSession();

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">資料備份</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        每個看板一個 CSV 檔:涵蓋這個看板上所有工作項跟每個欄位的值。匯出改完再匯入回來是真的往返——
        既有工作項會被更新,不是每次都當新的加進去;CSV 裡沒提到的工作項維持原樣,不會被刪除。範圍不含
        留言、附件、稽核紀錄——人力表、樣機計畫、樣機 BOM 這幾張規劃表則各自有自己的 Excel 匯出入。
      </p>
      <DataExportView canImport={session.role === "ADMIN"} />
    </div>
  );
}

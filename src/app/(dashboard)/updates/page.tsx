import { requireSession } from "@/lib/session";
import { loadUpdateFeed } from "@/lib/updateFeed";
import { UpdateFeed } from "@/components/updates/UpdateFeed";

export default async function UpdatesPage() {
  const session = await requireSession();
  const rows = await loadUpdateFeed(session);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">更新記錄</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        工作項的更新與變化,以及風險、問題的新增、指派、變更,新的在前。預設只看「與我有關」的:我做的、指派給我的工作項、我負責或審核的風險與問題;
        按「全部」可以看整個看板上所有人發生的事。跟通知不同的是,通知只在「被指派、被提到」那一刻提醒你。
        點一筆跳到那個工作項(留言跳「更新」分頁,狀態與欄位修改跳「項目卡片」),風險與問題跳到那個看板的風險分頁。
      </p>
      <UpdateFeed rows={rows} />
    </div>
  );
}

/**
 * 有子項目的項目,進度是子項目的平均(沒填的算 0%),不是它自己填的數字——所以表格與項目卡片
 * 都只顯示、不給輸入。見 computeItemProgress。
 */
export function RollupProgress({
  value,
  childCount,
}: {
  value: number | null;
  childCount: number;
}) {
  if (value === null) {
    return <span className="px-2 text-xs text-neutral-400 dark:text-neutral-500">—</span>;
  }
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="flex items-center gap-2 px-2"
      title={`依 ${childCount} 個子項目自動計算`}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

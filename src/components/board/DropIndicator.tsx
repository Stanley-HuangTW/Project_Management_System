import type { DropZone } from "@/lib/dragReorder";

/** 拖曳工作項時的放置提示——甘特圖跟表格視圖的列元件共用同一份,各自疊在自己
 *  (position: relative 的)列容器上。label 是放開之後的結果說明(新 WBS 編號、
 *  放在誰底下/跟誰同階),直接顯示在目標列上,不用放開才知道放到哪。*/
export function DropIndicator({
  zone,
  indentPx,
  label,
}: {
  zone: DropZone;
  indentPx: number;
  label?: string | null;
}) {
  // 說明浮在目標列的上緣、不蓋住它自己的名稱。放在上緣(不是下緣)是因為甘特圖
  // 每一列的標籤欄各自是一個 z-10 的堆疊層,往下溢出會被下一列蓋住。
  const badge = label ? (
    <div className="pointer-events-none absolute right-1 top-0 z-20 max-w-[80%] -translate-y-1/2 truncate rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
      {label}
    </div>
  ) : null;

  if (zone === "child") {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-inset ring-blue-400" />
        {badge}
      </>
    );
  }
  return (
    <>
      <div
        className="pointer-events-none absolute bottom-0 right-0 h-0.5 bg-blue-500"
        style={{ left: indentPx }}
      />
      {badge}
    </>
  );
}

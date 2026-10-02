import type { DropZone } from "@/lib/dragReorder";

/** 拖曳工作項時的放置提示——甘特圖跟表格視圖的列元件共用同一份,各自疊在自己
 *  (position: relative 的)列容器上。*/
export function DropIndicator({ zone, indentPx }: { zone: DropZone; indentPx: number }) {
  if (zone === "child") {
    return <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-inset ring-blue-400" />;
  }
  return (
    <div
      className="pointer-events-none absolute bottom-0 right-0 h-0.5 bg-blue-500"
      style={{ left: indentPx }}
    />
  );
}

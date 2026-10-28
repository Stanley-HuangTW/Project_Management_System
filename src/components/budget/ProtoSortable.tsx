"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** 放在抓取把手上的屬性。 */
export type HandleProps = HTMLAttributes<HTMLElement>;

/** 樣機計畫表的一列:只有 children 收到的把手能上下拖(列裡的格子照常可以點、可以打字)。 */
export function SortableTr({
  id,
  dataKey,
  className,
  children,
}: {
  id: string;
  dataKey: string;
  className?: string;
  children: (handle: HandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    // 只上下移動,不跟著游標左右飄。
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 20, opacity: 0.75 } : null),
  };
  return (
    <tr ref={setNodeRef} style={style} data-proto-row={dataKey} className={className}>
      {children({ ...attributes, ...listeners })}
    </tr>
  );
}

/** 樣機計畫表的一個階段欄標題:只有 children 收到的把手能左右拖。 */
export function SortableTh({ id, className, children }: { id: string; className?: string; children: (handle: HandleProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    // 只左右移動。
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 20, opacity: 0.75 } : null),
  };
  return (
    <th ref={setNodeRef} style={style} className={className}>
      {children({ ...attributes, ...listeners })}
    </th>
  );
}

"use client";

import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** 放在抓取把手上的屬性;沒有指定 handle 時整列都能拖,這個就是空的。 */
export type DragHandleProps = HTMLAttributes<HTMLElement>;

function Row({
  id,
  disabled,
  handle,
  children,
}: {
  id: string;
  disabled: boolean;
  handle: boolean;
  children: (handleProps: DragHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = {
    // 只上下移動,不跟著游標左右飄。
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 20, opacity: 0.75 } : null),
  };
  return (
    // 整列拖曳時只掛游標事件,不掛 role/tabIndex:列裡面本來就有連結與按鈕。
    <div ref={setNodeRef} style={style} {...(handle ? null : listeners)}>
      {children(handle ? { ...attributes, ...listeners } : {})}
    </div>
  );
}

/**
 * 可以上下拖曳排序的清單。不產生自己的外框——每一列包一層 div,沒有別的 DOM,所以放在
 * space-y 之類的容器裡排版不變。移動超過 5px 才算拖曳,所以列裡的連結、按鈕照常可以點。
 * handle=true 時整列不能拖,只有 children 收到的 handleProps 掛上去的那個把手能拖。
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  disabled = false,
  handle = false,
  children,
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  disabled?: boolean;
  handle?: boolean;
  children: (item: T, handleProps: DragHandleProps) => ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const ids = items.map((item) => item.id);

  // 放開滑鼠後,瀏覽器會對被拖的那一列補一個 click(列裡是連結的話就跳頁了)——拖曳剛結束的那一下把它吞掉。
  // 掛在 document 的捕獲階段、而且比 dnd-kit 自己的先掛,才擋得到連結本身的預設跳轉。
  const lastDragEnd = useRef(0);
  useEffect(() => {
    function swallowClick(event: MouseEvent) {
      if (Date.now() - lastDragEnd.current > 300) return;
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("click", swallowClick, true);
    return () => document.removeEventListener("click", swallowClick, true);
  }, []);

  function handleDragEnd({ active, over }: DragEndEvent) {
    lastDragEnd.current = Date.now();
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
      onDragCancel={() => {
        lastDragEnd.current = Date.now();
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <Row key={item.id} id={item.id} disabled={disabled} handle={handle}>
            {(handleProps) => children(item, handleProps)}
          </Row>
        ))}
      </SortableContext>
    </DndContext>
  );
}

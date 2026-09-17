"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 會左右捲的區塊,上下各一條捲軸。
 *
 * 一張寬表格的捲軸只長在最底下,而表格有幾十列的時候那條捲軸在畫面外 ——
 * 使用者看得到右邊被切掉,卻沒有東西可以拖。甘特圖早就自己做了一條貼在
 * 頂端的,這裡把它抽出來,其餘的表格才不用各自再抄一次。
 *
 * 上面那條只有在真的捲得動的時候才出現:內容塞得下卻多一條灰槓,反而像
 * 壞掉的。
 */
export function HScrollPane({
  children,
  className = "",
  /** 捲動容器自己的樣式,例如高度上限。 */
  viewportClassName = "",
}: {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    setContentWidth(el.scrollWidth);
    // 差一兩個 px 不算捲得動,那多半是四捨五入。
    setOverflows(el.scrollWidth > el.clientWidth + 2);
  }, []);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    measure();

    // 容器變窄、或內容本身變寬(換了篩選、展開了一列)都要重量。
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, children]);

  /**
   * 兩條捲軸互相跟隨。
   *
   * 沒有用旗標擋回彈,因為「值已經一樣就不要再設」本身就會收斂:設一個跟
   * 現在相同的 scrollLeft 不會觸發 scroll 事件,連鎖就停在那裡。
   *
   * 原本是用一個旗標加 requestAnimationFrame 放開,結果是分頁在背景或面板
   * 被收起來的時候 rAF 不保證會跑,旗標卡在 true,從此之後兩條就再也不同
   * 步了 —— 那種壞法只在看不到的時候發生,最難查。
   */
  function sync(source: "top" | "main") {
    const top = topRef.current;
    const main = mainRef.current;
    if (!top || !main) return;
    const [from, to] = source === "top" ? [top, main] : [main, top];
    // 容器寬度不同時瀏覽器會把 scrollLeft 夾成小數,差一點點不算不同步。
    if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft;
  }

  return (
    <div className={className}>
      {overflows && (
        <div
          ref={topRef}
          onScroll={() => sync("top")}
          className="overflow-x-auto overflow-y-hidden"
          style={{ height: 12 }}
          aria-hidden
        >
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      )}
      <div
        ref={mainRef}
        onScroll={() => sync("main")}
        className={`overflow-x-auto ${viewportClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

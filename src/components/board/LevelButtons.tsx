"use client";

import { IndentDecrease, IndentIncrease } from "lucide-react";

/**
 * 項目列上的「升階 / 降階」小按鈕,滑過那一列才出現(鍵盤聚焦也會出現)。
 * 做不到的那個方向不畫:第一個同層項目沒有前一項可以降階、最上層沒有父項可以升階。
 * 父層這一列要有 `group` class。
 */
export function LevelButtons({
  canIndent,
  canOutdent,
  onIndent,
  onOutdent,
  size = 14,
}: {
  canIndent: boolean;
  canOutdent: boolean;
  onIndent: () => void;
  onOutdent: () => void;
  size?: number;
}) {
  if (!canIndent && !canOutdent) return null;
  const className =
    "shrink-0 rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
  return (
    <>
      {canOutdent && (
        <button type="button" onClick={onOutdent} title="升階(Shift+Tab):提升一階,變成父項的同層項目" aria-label="升階" className={className}>
          <IndentDecrease size={size} />
        </button>
      )}
      {canIndent && (
        <button type="button" onClick={onIndent} title="降階(Tab):變成上一項的子項" aria-label="降階" className={className}>
          <IndentIncrease size={size} />
        </button>
      )}
    </>
  );
}

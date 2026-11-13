"use client";

import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease } from "lucide-react";

/**
 * 項目列上的「升階 / 降階 / 上移 / 下移」小按鈕,滑過那一列才出現(鍵盤聚焦也會出現)。
 * 做不到的那個方向不畫:第一個同層項目沒有前一項可以降階或上移、最後一個不能下移、最上層沒有父項可以升階。
 * 父層這一列要有 `group` class。
 */
export function LevelButtons({
  canIndent,
  canOutdent,
  onIndent,
  onOutdent,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  size = 14,
}: {
  canIndent: boolean;
  canOutdent: boolean;
  onIndent: () => void;
  onOutdent: () => void;
  /** 同一層裡往上 / 往下移一格(整棵子樹跟著走,階層不變)。 */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  size?: number;
}) {
  if (!canIndent && !canOutdent && !canMoveUp && !canMoveDown) return null;
  const className =
    "shrink-0 rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";
  return (
    <>
      {canOutdent && (
        <button type="button" onClick={onOutdent} title="升階(Shift+Tab):提升一階,變成父項的同層項目;下面的同層項目變成它的子項" aria-label="升階" className={className}>
          <IndentDecrease size={size} />
        </button>
      )}
      {canIndent && (
        <button type="button" onClick={onIndent} title="降階(Tab):變成上一項的子項" aria-label="降階" className={className}>
          <IndentIncrease size={size} />
        </button>
      )}
      {canMoveUp && onMoveUp && (
        <button type="button" onClick={onMoveUp} title="上移:跟同一層的前一個項目對調位置(子項目一起移)" aria-label="上移" className={className}>
          <ArrowUp size={size} />
        </button>
      )}
      {canMoveDown && onMoveDown && (
        <button type="button" onClick={onMoveDown} title="下移:跟同一層的下一個項目對調位置(子項目一起移)" aria-label="下移" className={className}>
          <ArrowDown size={size} />
        </button>
      )}
    </>
  );
}

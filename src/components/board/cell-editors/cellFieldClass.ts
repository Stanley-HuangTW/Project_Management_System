/**
 * 可輸入的儲存格長什麼樣。
 *
 * 表格裡(grid)不畫框:兩千多個格子各有邊框會變成一片格線,滑過去才給底色
 * 就夠了。項目卡片裡(form)要畫框:每個欄位自己一列,沒有框的話看起來就
 * 只是一行字,沒人知道可以點下去打字。
 */
export function cellFieldClass(bordered: boolean): string {
  const base =
    "w-full rounded px-2 py-1 text-sm outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400";
  return bordered
    ? `${base} border border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900`
    : base;
}

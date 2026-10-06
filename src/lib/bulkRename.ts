export type RenameChange = { id: string; from: string; to: string };

export type RenamePlan = {
  changes: RenameChange[];
  /** 名稱裡沒有出現要找的字樣。 */
  unchangedIds: string[];
  /** 取代之後名稱會變成空白——不改,免得變成「未命名項目」。 */
  blankIds: string[];
};

/**
 * 批次「取代名稱字樣」:每個名稱裡所有出現 `find` 的地方都換成 `replace`。
 * 照字面比對、區分大小寫(用 split/join,不走 RegExp,所以 `.`、`(`、`$&` 都只是一般字元)。
 * 結果會 trim,跟 renameItem 一致。畫面預覽與 server 都用這一份,兩邊算出來才會一樣。
 */
export function planNameReplace(
  items: { id: string; name: string }[],
  find: string,
  replace: string
): RenamePlan {
  const plan: RenamePlan = { changes: [], unchangedIds: [], blankIds: [] };
  for (const { id, name } of items) {
    if (!find || !name.includes(find)) {
      plan.unchangedIds.push(id);
      continue;
    }
    const to = name.split(find).join(replace).trim();
    if (to === "") plan.blankIds.push(id);
    else if (to === name) plan.unchangedIds.push(id);
    else plan.changes.push({ id, from: name, to });
  }
  return plan;
}

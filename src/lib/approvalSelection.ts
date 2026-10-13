/**
 * 待我審核頁的批次選取:一筆待審的東西(工時、專案會議與其他工時、請假)用「種類:id」當 key,
 * 選取的集合就是一包 key。純邏輯,不碰 React / Prisma。
 */

export type ApprovalKind = "time" | "activity" | "leave";

export type ApprovalTarget = { kind: ApprovalKind; id: string };

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  time: "工時",
  activity: "專案會議與其他工時",
  leave: "請假",
};

const KINDS = Object.keys(APPROVAL_KIND_LABEL) as ApprovalKind[];

export function selectionKey(kind: ApprovalKind, id: string): string {
  return `${kind}:${id}`;
}

/** key 還原成 { kind, id };種類不認得就是 null。 */
export function parseSelectionKey(key: string): ApprovalTarget | null {
  const at = key.indexOf(":");
  if (at <= 0) return null;
  const kind = key.slice(0, at) as ApprovalKind;
  const id = key.slice(at + 1);
  return KINDS.includes(kind) && id ? { kind, id } : null;
}

export type SelectableRow = { key: string; userId: string; userName: string };

export type PersonGroup = { userId: string; userName: string; keys: string[] };

/** 依送審的人分組(同一個人的三種待審都算在一起),名字排序。 */
export function groupByPerson(rows: SelectableRow[]): PersonGroup[] {
  const byUser = new Map<string, PersonGroup>();
  for (const row of rows) {
    const group = byUser.get(row.userId) ?? { userId: row.userId, userName: row.userName, keys: [] };
    group.keys.push(row.key);
    byUser.set(row.userId, group);
  }
  return [...byUser.values()].sort((a, b) => a.userName.localeCompare(b.userName) || a.userId.localeCompare(b.userId));
}

export type PersonState = "none" | "some" | "all";

/** 這個人的待審裡,選了幾成:一筆都沒選 / 選了一部分 / 全選。 */
export function personState(selected: ReadonlySet<string>, keys: string[]): PersonState {
  const count = keys.filter((key) => selected.has(key)).length;
  if (count === 0) return "none";
  return count === keys.length ? "all" : "some";
}

/** 點人員:他的待審已經全選就全部取消,否則(沒選或只選一部分)補成全選。不動別人的。 */
export function togglePerson(selected: ReadonlySet<string>, keys: string[]): Set<string> {
  const next = new Set(selected);
  if (personState(selected, keys) === "all") {
    for (const key of keys) next.delete(key);
  } else {
    for (const key of keys) next.add(key);
  }
  return next;
}

/** 選取的 key 轉成要送給伺服器的清單;不認得的 key 略過。 */
export function targetsOf(selected: Iterable<string>): ApprovalTarget[] {
  const targets: ApprovalTarget[] = [];
  for (const key of selected) {
    const target = parseSelectionKey(key);
    if (target) targets.push(target);
  }
  return targets;
}

/** 「工時 10、請假 1」——確認視窗裡說明選了什麼。 */
export function describeTargets(targets: ApprovalTarget[]): string {
  return KINDS.map((kind) => ({ kind, count: targets.filter((t) => t.kind === kind).length }))
    .filter((x) => x.count > 0)
    .map((x) => `${APPROVAL_KIND_LABEL[x.kind]} ${x.count}`)
    .join("、");
}

/**
 * 統計頁的人員選取。selected 是 null 代表「看得到的全部人」,否則是被選的 id 清單。
 * 選到跟全部一樣時一律收成 null,這樣之後新增的人也會自動在選取範圍裡。
 */

export type SelectablePerson = { id: string; discipline: string | null };

function normalize(ids: string[], people: SelectablePerson[]): string[] | null {
  const set = new Set(ids);
  return people.every((p) => set.has(p.id)) ? null : people.filter((p) => set.has(p.id)).map((p) => p.id);
}

/** 目前實際被選到的人。 */
export function selectedPeople<T extends SelectablePerson>(selected: string[] | null, people: T[]): T[] {
  if (selected === null) return people;
  const set = new Set(selected);
  return people.filter((p) => set.has(p.id));
}

export function togglePerson(selected: string[] | null, people: SelectablePerson[], id: string): string[] | null {
  const current = selected ?? people.map((p) => p.id);
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  return normalize(next, people);
}

/** 這個部門被選到的程度:全部 / 部分 / 沒有。 */
export function departmentState(
  selected: string[] | null,
  people: SelectablePerson[],
  code: string
): "all" | "some" | "none" {
  const members = people.filter((p) => p.discipline === code);
  if (members.length === 0) return "none";
  const set = selected === null ? null : new Set(selected);
  const count = members.filter((p) => set === null || set.has(p.id)).length;
  return count === members.length ? "all" : count === 0 ? "none" : "some";
}

/**
 * 按一下部門:目前是「全部人」就只留下這個部門(最常見的用法:只看這個部門);
 * 否則這個部門全選了就取消,沒全選就補齊,可以一個一個部門加上去。
 */
export function toggleDepartment(selected: string[] | null, people: SelectablePerson[], code: string): string[] | null {
  const members = people.filter((p) => p.discipline === code).map((p) => p.id);
  if (members.length === 0) return selected;
  if (selected === null) return normalize(members, people);
  if (departmentState(selected, people, code) === "all") {
    const drop = new Set(members);
    return normalize(selected.filter((id) => !drop.has(id)), people);
  }
  return normalize([...new Set([...selected, ...members])], people);
}

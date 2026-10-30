/**
 * Mantis 的使用者 ↔ 本系統的同仁怎麼對上(處理人 ↔ 負責人)。純邏輯:不打 Mantis、不碰資料庫。
 *
 * 依序比對,前面對得上就不往下:
 *   1. 手動對應(系統設定的「欄位對應與寫回」→「處理人對應」,管理者指定的,最準);
 *   2. Email 相同(Mantis 的 REST API 只有在 token 的帳號有權限看 Email 時才會回,所以常常是空的);
 *   3. 名稱相同:Mantis 的使用者名稱或姓名,跟本系統同仁的姓名或 Email 帳號(@ 前面那段)——
 *      忽略大小寫與空白、底線、點、減號(Jason_Huang = jason.huang = Jason Huang)。
 *      只有「恰好一位」符合才算,同名同姓的兩個人寧可不對,免得指派錯人。
 */
export type LocalPerson = { id: string; name: string; email: string };
export type MantisPerson = { id?: number | null; name?: string | null; realName?: string | null; email?: string | null };
export type PersonMatchHow = "manual" | "email" | "name";

const normalize = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s_.\-·]/g, "");
const emailOf = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const accountOf = (email: string) => email.split("@")[0] ?? "";

/** 本系統同仁用來比對名稱的鍵:姓名、Email 帳號(@ 前面那段)。 */
const localKeys = (p: LocalPerson) => [normalize(p.name), normalize(accountOf(p.email))].filter(Boolean);
/** Mantis 使用者用來比對名稱的鍵:使用者名稱、姓名、Email 帳號。 */
const mantisKeys = (p: MantisPerson) => [normalize(p.name), normalize(p.realName), normalize(accountOf(emailOf(p.email)))].filter(Boolean);

function uniqueBy<T>(candidates: T[], keyOf: (t: T) => string): T | null {
  const distinct = new Map(candidates.map((c) => [keyOf(c), c]));
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}

/** Mantis 的處理人 → 本系統的哪位同仁;對不上回 null。overrides 是「本系統使用者 id → Mantis 使用者 id」。 */
export function matchLocalPerson(
  person: MantisPerson,
  locals: LocalPerson[],
  overrides: Record<string, number> = {}
): { userId: string; how: PersonMatchHow } | null {
  if (person.id) {
    const manual = locals.find((l) => overrides[l.id] === person.id);
    if (manual) return { userId: manual.id, how: "manual" };
  }
  const email = emailOf(person.email);
  if (email) {
    const byEmail = locals.find((l) => emailOf(l.email) === email);
    if (byEmail) return { userId: byEmail.id, how: "email" };
  }
  const keys = new Set(mantisKeys(person));
  if (keys.size === 0) return null;
  const byName = uniqueBy(locals.filter((l) => localKeys(l).some((k) => keys.has(k))), (l) => l.id);
  return byName ? { userId: byName.id, how: "name" } : null;
}

/** 本系統的同仁 → Mantis 的哪位使用者(寫回處理人用);規則跟上面對稱。 */
export function matchMantisPerson<M extends { id: number } & MantisPerson>(
  local: LocalPerson,
  mantisUsers: M[],
  overrides: Record<string, number> = {}
): { user: M; how: PersonMatchHow } | null {
  const manualId = overrides[local.id];
  if (manualId) {
    // 手動指定的 Mantis 使用者就算還沒被同步收集到,也照用(只要有編號就能寫回)。
    const known = mantisUsers.find((u) => u.id === manualId);
    return { user: known ?? ({ id: manualId } as M), how: "manual" };
  }
  const email = emailOf(local.email);
  if (email) {
    const byEmail = mantisUsers.find((u) => emailOf(u.email) === email);
    if (byEmail) return { user: byEmail, how: "email" };
  }
  const keys = new Set(localKeys(local));
  if (keys.size === 0) return null;
  const byName = uniqueBy(mantisUsers.filter((u) => mantisKeys(u).some((k) => keys.has(k))), (u) => String(u.id));
  return byName ? { user: byName, how: "name" } : null;
}

export const MATCH_HOW_LABELS: Record<PersonMatchHow, string> = { manual: "手動指定", email: "Email 相同", name: "名稱相同" };

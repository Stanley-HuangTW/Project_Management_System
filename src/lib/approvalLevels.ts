/**
 * 多階簽核:請假、工時的「主管這一條路」可以要求幾階主管都同意。
 *
 * 主管階層沿用 User.supervisorId 一路往上(組織架構圖算出來的就是這個):第 1 階 = 直屬主管,
 * 第 2 階 = 直屬主管的主管,依此類推。各階同時送審,所有需要的階都簽了才成立;
 * 設定要 3 階但這個人頭上只有 2 階主管,就算到最高那一階。純函式。
 */

export type ChainNode = { id: string; supervisorId?: string | null };

/** 某個人頭上的主管,由近到遠(直屬 → 二階 → 三階…)。成環就停在看過的人。maxLevels 限制最多回幾階。 */
export function managerChain(users: ChainNode[], userId: string, maxLevels = Infinity): string[] {
  const supervisorOf = new Map(users.map((u) => [u.id, u.supervisorId ?? null]));
  const chain: string[] = [];
  const seen = new Set<string>([userId]);
  let current = supervisorOf.get(userId) ?? null;
  while (current && !seen.has(current) && chain.length < maxLevels) {
    chain.push(current);
    seen.add(current);
    current = supervisorOf.get(current) ?? null;
  }
  return chain;
}

const LEVEL_LABELS = ["直屬主管", "二階主管", "三階主管", "四階主管", "五階主管", "六階主管"];

/** 第幾階主管的稱呼。1 = 直屬主管。 */
export function levelLabel(level: number): string {
  return LEVEL_LABELS[level - 1] ?? `${level} 階主管`;
}

/** 設定值整理成 1~MAX_LEVELS 的整數。 */
export const MAX_APPROVAL_LEVELS = 5;
export function clampLevels(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_APPROVAL_LEVELS, Math.max(1, n));
}

/** 這個人實際要簽幾階:設定的階數與他頭上實際有的階數取小的(頭上沒有主管 = 0,這一條路不存在)。 */
export function requiredLevels(chainLength: number, configured: number): number {
  return Math.min(clampLevels(configured), chainLength);
}

export type ApprovalStepLite = { level: number };

export type ApprovalProgress = {
  /** 需要簽幾階(0 = 他沒有主管,這一條路不存在)。 */
  required: number;
  /** 已經簽了的階。 */
  done: number[];
  /** 還沒簽的階。 */
  missing: number[];
  complete: boolean;
};

export function approvalProgress(chainLength: number, configured: number, steps: ApprovalStepLite[]): ApprovalProgress {
  const required = requiredLevels(chainLength, configured);
  const signed = new Set(steps.map((s) => s.level));
  const levels = Array.from({ length: required }, (_, i) => i + 1);
  const done = levels.filter((l) => signed.has(l));
  const missing = levels.filter((l) => !signed.has(l));
  return { required, done, missing, complete: required > 0 && missing.length === 0 };
}

/**
 * userId 對這筆紀錄能簽哪一階:他在送審者的主管鏈上、那一階在需要的範圍內、而且還沒簽。
 * 不能簽回 null(不是主管、階數超過設定、或那一階已經簽過)。
 */
export function levelToSign(chain: string[], configured: number, steps: ApprovalStepLite[], userId: string): number | null {
  const index = chain.indexOf(userId);
  if (index < 0) return null;
  const level = index + 1;
  const progress = approvalProgress(chain.length, configured, steps);
  return progress.missing.includes(level) ? level : null;
}

/**
 * 給核准人看的進度說明:「需 2 階主管同意 — 已簽:直屬主管 王大明;尚待:二階主管 陳經理」。
 * 只有一階(或沒有主管)的時候不需要特別說,回 null。
 */
export function describeApprovalProgress(args: {
  chain: string[];
  configured: number;
  steps: { level: number; approverId: string }[];
  nameOf: (userId: string) => string;
}): string | null {
  const { chain, configured, steps, nameOf } = args;
  const progress = approvalProgress(chain.length, configured, steps);
  if (progress.required <= 1) return null;
  const signed = progress.done.map((level) => {
    const step = steps.find((s) => s.level === level);
    return `${levelLabel(level)} ${nameOf(step?.approverId ?? chain[level - 1])}`;
  });
  const waiting = progress.missing.map((level) => `${levelLabel(level)} ${nameOf(chain[level - 1])}`);
  return [`需 ${progress.required} 階主管同意`, signed.length > 0 ? `已簽:${signed.join("、")}` : null, `尚待:${waiting.join("、")}`]
    .filter(Boolean)
    .join(" — ");
}

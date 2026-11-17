/**
 * ISSUE TRACKER 的存取規則。純函式,不碰資料庫:誰能進哪個系統、案件誰能改什麼。
 *
 * 兩個系統共用帳號:專案管理系統看 UserRole(ADMIN / SUPERVISOR / MEMBER)與 pmAccess,
 * ISSUE TRACKER 看 issueRole(回報人 / 處理人 / 管理者)。管理者(ADMIN)兩邊都一律可進,
 * 在 ISSUE TRACKER 裡等同管理者。
 */

export type IssueRole = "REPORTER" | "HANDLER" | "MANAGER";

export const ISSUE_ROLE_LABELS: Record<IssueRole, string> = {
  REPORTER: "回報人",
  HANDLER: "處理人",
  MANAGER: "管理者",
};

export type AccessUser = {
  role: "ADMIN" | "SUPERVISOR" | "MEMBER";
  pmAccess: boolean;
  issueRole: IssueRole | null;
};

export type SystemAccess = { pm: boolean; issues: boolean };

export function systemAccess(user: AccessUser): SystemAccess {
  if (user.role === "ADMIN") return { pm: true, issues: true };
  return { pm: user.pmAccess, issues: user.issueRole !== null };
}

/**
 * 登入後(或打開根網址)要去哪裡。兩個系統都能進才出現選擇頁;
 * 只能進專案管理的人行為跟以前完全一樣(直接進看板),不多一個選擇畫面。
 */
export function postLoginPath(access: SystemAccess): "/boards" | "/issues" | "/select-system" | "/no-access" {
  if (access.pm && access.issues) return "/select-system";
  if (access.pm) return "/boards";
  if (access.issues) return "/issues";
  return "/no-access";
}

/** 在 ISSUE TRACKER 裡的有效角色:管理者(ADMIN)一律等同管理者;沒有角色 = 不能進。 */
export function effectiveIssueRole(user: Pick<AccessUser, "role" | "issueRole">): IssueRole | null {
  if (user.role === "ADMIN") return "MANAGER";
  return user.issueRole;
}

/** 選項管理(原 _mgt 分頁)、刪除案件、解除鎖定、改派:只有管理者。 */
export function canManageIssues(role: IssueRole | null): boolean {
  return role === "MANAGER";
}

export type IssueCaseFacts = {
  reporterId: string | null;
  assigneeIds: string[];
  /** 已經有人確認完成 → 鎖定。 */
  locked: boolean;
};

/**
 * 能不能改「回報的內容」(客戶、機型、描述…):
 * 管理者隨時可以;其他人只能改尚未鎖定的案件 —— 處理人改自己負責或還沒人負責的,回報人改自己回報的。
 */
export function canEditReportFields(role: IssueRole | null, userId: string, c: IssueCaseFacts): boolean {
  if (role === null) return false;
  if (role === "MANAGER") return true;
  if (c.locked) return false;
  if (c.reporterId === userId) return true;
  return role === "HANDLER" && (c.assigneeIds.length === 0 || c.assigneeIds.includes(userId));
}

/**
 * 能不能改「處理的內容」(狀態、結案日、更換零件、RMA、處理單位、機器計數…):
 * 回報人不能(他只回報,不處理);處理人限自己負責或還沒人負責的案件;管理者隨時。
 */
export function canEditHandlingFields(role: IssueRole | null, userId: string, c: IssueCaseFacts): boolean {
  if (role === "MANAGER") return true;
  if (role !== "HANDLER" || c.locked) return false;
  return c.assigneeIds.length === 0 || c.assigneeIds.includes(userId);
}

/** 時間軸留言:沒鎖定的案件所有人都能留言;鎖定後只有管理者與負責的處理人能補寫(「處理人可補時間軸」)。 */
export function canAddLog(role: IssueRole | null, userId: string, c: IssueCaseFacts): boolean {
  if (role === null) return false;
  if (role === "MANAGER") return true;
  if (!c.locked) return true;
  return role === "HANDLER" && c.assigneeIds.includes(userId);
}

/** 確認案件完成(鎖定):案件要已經是 TC 或 PC;由管理者或原回報人確認。 */
export function canConfirmCase(
  role: IssueRole | null,
  userId: string,
  c: IssueCaseFacts & { status: "OPEN" | "TC" | "PC" | "NA" }
): boolean {
  if (role === null || c.locked) return false;
  if (c.status !== "TC" && c.status !== "PC") return false;
  return role === "MANAGER" || c.reporterId === userId;
}

/** 負責人「接手」:處理人對還沒人負責、尚未鎖定的案件,可以把自己加為負責人。 */
export function canClaimCase(role: IssueRole | null, c: IssueCaseFacts): boolean {
  return role === "HANDLER" && !c.locked && c.assigneeIds.length === 0;
}

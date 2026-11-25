/**
 * 客服維修流程(Sales → FAE → RD …)的階段與規則。純函式,不碰資料庫。
 *
 * 階段(stage)看「案件走到哪、輪到誰」,跟狀態(處理中 / TC / PC)是兩件事。
 * 流程圖:Issue 線 通報 → FAE 評估 →(要 RD 就 RD 處理中 → 回 FAE)→ 待 Sales 判斷 → 結案 或 轉 Repair;
 * Repair 線 通報 / FAE 評估 → 運送中 → 已收件(配件清點)→ 維修中 → 維修完成 → 結案(現場更換直接 FAE 評估 → 維修中)。
 */

export type IssueLane = "SALES" | "FAE" | "RD";
export type IssueStage =
  | "REPORTED"
  | "FAE_REVIEW"
  | "RD_WORKING"
  | "SALES_DECISION"
  | "IN_TRANSIT"
  | "RECEIVED"
  | "REPAIRING"
  | "REPAIRED"
  | "CLOSING"
  | "CLOSED";
export type FlowKind = "ISSUE" | "REPAIR";

export const ISSUE_LANES: IssueLane[] = ["SALES", "FAE", "RD"];
export const ISSUE_LANE_LABELS: Record<IssueLane, string> = { SALES: "Sales", FAE: "FAE", RD: "RD" };

export const ISSUE_STAGE_LABELS: Record<IssueStage, string> = {
  REPORTED: "已通報",
  FAE_REVIEW: "FAE 評估",
  RD_WORKING: "RD 處理中",
  SALES_DECISION: "待 Sales 判斷",
  IN_TRANSIT: "運送中",
  RECEIVED: "已收件(配件清點)",
  REPAIRING: "維修中",
  REPAIRED: "維修完成",
  CLOSING: "結案簽核中",
  CLOSED: "已結案",
};

export const ISSUE_STAGE_KEYS = Object.keys(ISSUE_STAGE_LABELS) as IssueStage[];

/** 每個階段輪到哪個角色處理;結案簽核中 / 已結案不屬於任何泳道。 */
export const STAGE_LANE: Record<IssueStage, IssueLane | null> = {
  REPORTED: "SALES",
  FAE_REVIEW: "FAE",
  RD_WORKING: "RD",
  SALES_DECISION: "SALES",
  IN_TRANSIT: "SALES",
  RECEIVED: "SALES",
  REPAIRING: "FAE",
  REPAIRED: "SALES",
  CLOSING: null,
  CLOSED: null,
};

/** 進度條上依序顯示的階段。 */
export function stageTrack(kind: FlowKind): IssueStage[] {
  return kind === "REPAIR"
    ? ["REPORTED", "FAE_REVIEW", "IN_TRANSIT", "RECEIVED", "REPAIRING", "REPAIRED", "CLOSING", "CLOSED"]
    : ["REPORTED", "FAE_REVIEW", "RD_WORKING", "SALES_DECISION", "CLOSING", "CLOSED"];
}

/**
 * 可以往前推進到哪些階段(流程圖上的每一條線)。
 * 「已結案」不在這裡:結案走「確認完成」(之後是結案簽核),不是手動推進。
 */
const FORWARD: Record<FlowKind, Partial<Record<IssueStage, IssueStage[]>>> = {
  ISSUE: {
    REPORTED: ["FAE_REVIEW"],
    FAE_REVIEW: ["RD_WORKING", "SALES_DECISION"],
    RD_WORKING: ["FAE_REVIEW", "SALES_DECISION"],
    // 問題還沒解決也不需要維修:回到通報繼續處理。
    SALES_DECISION: ["REPORTED"],
  },
  REPAIR: {
    REPORTED: ["FAE_REVIEW", "IN_TRANSIT"],
    // 要送回 → 運送中;現場更換 → 直接維修中。
    FAE_REVIEW: ["IN_TRANSIT", "REPAIRING"],
    IN_TRANSIT: ["RECEIVED"],
    RECEIVED: ["REPAIRING"],
    REPAIRING: ["REPAIRED"],
  },
};

/** 這個階段可以往前推進到哪些階段。 */
export function nextStages(kind: FlowKind, stage: IssueStage): IssueStage[] {
  return FORWARD[kind][stage] ?? [];
}

/** 可以退回到哪些階段:進度條上排在前面、而且有線指到目前這一階的(推錯了、要補資料時退回去)。 */
export function backStages(kind: FlowKind, stage: IssueStage): IssueStage[] {
  const track = stageTrack(kind);
  const at = track.indexOf(stage);
  return track.filter((s, i) => i < at && nextStages(kind, s).includes(stage));
}

export type StageMove = { to: IssueStage; direction: "FORWARD" | "BACK" };

/** 目前可以做的所有移動(畫面上的按鈕);結案後沒有。 */
export function availableMoves(kind: FlowKind, stage: IssueStage): StageMove[] {
  if (stage === "CLOSED" || stage === "CLOSING") return [];
  const forward = nextStages(kind, stage).map((to) => ({ to, direction: "FORWARD" as const }));
  const back = backStages(kind, stage)
    .filter((s) => !nextStages(kind, stage).includes(s))
    .map((to) => ({ to, direction: "BACK" as const }));
  return [...forward, ...back];
}

export function isStageMove(kind: FlowKind, from: IssueStage, to: IssueStage): boolean {
  return availableMoves(kind, from).some((m) => m.to === to);
}

/** Issue 轉 Repair 之後落在哪個階段:流程圖是「Issue 轉 Repair → 聯絡送回」。 */
export const TO_REPAIR_STAGE: IssueStage = "IN_TRANSIT";

/** 能不能把 Issue 轉成 Repair:Issue 案件、在「待 Sales 判斷」或「FAE 評估」(FAE 發現其實要維修)。 */
export function canConvertToRepair(kind: FlowKind, stage: IssueStage): boolean {
  return kind === "ISSUE" && (stage === "SALES_DECISION" || stage === "FAE_REVIEW");
}

export type FlowActor = { issueRole: "REPORTER" | "HANDLER" | "MANAGER" | null; userId: string; lanes: IssueLane[] };
export type FlowFacts = { assigneeIds: string[]; stage: IssueStage; locked: boolean };

/**
 * 能不能推進這個案件的階段:管理者隨時;處理人在「目前這一階輪到的角色」是自己的時候,或自己是負責人;
 * 回報人不行。案件鎖定(確認完成)後只有管理者。沒有任何人設定過流程角色時,負責人就是唯一的處理人,
 * 所以「是負責人」也算——流程角色是補充,不是讓還沒設定的團隊用不了。
 */
export function canMoveStage(actor: FlowActor, facts: FlowFacts): boolean {
  if (actor.issueRole === "MANAGER") return true;
  if (actor.issueRole !== "HANDLER" || facts.locked) return false;
  if (facts.assigneeIds.includes(actor.userId)) return true;
  const lane = STAGE_LANE[facts.stage];
  return lane !== null && actor.lanes.includes(lane);
}

/** 案件確認完成(鎖定)或解除鎖定後的階段。解除鎖定回到「結案前」的那一階。 */
export function stageAfterUnlock(kind: FlowKind): IssueStage {
  return kind === "REPAIR" ? "REPAIRED" : "SALES_DECISION";
}

// ── 通知 ────────────────────────────────────────────────────────────

export type FlowEvent =
  | { type: "CREATED" }
  | { type: "STAGE"; to: IssueStage; direction: "FORWARD" | "BACK" }
  | { type: "TO_REPAIR" }
  | { type: "RD_UPDATED" }
  | { type: "CLOSED" }
  | { type: "STUCK"; stage: IssueStage; days: number };

/** 誰會收到:輪到的角色、案件相關的人。實際的人名單在伺服器端依這個描述展開。 */
export type FlowAudience = {
  lanes: IssueLane[];
  /** 負責人。 */
  assignees: boolean;
  /** 原回報人。 */
  reporter: boolean;
  /** ISSUE TRACKER 管理者。 */
  managers: boolean;
};

const NONE: FlowAudience = { lanes: [], assignees: false, reporter: false, managers: false };

/** 這個事件通知誰。 */
export function audienceFor(ev: FlowEvent): FlowAudience {
  switch (ev.type) {
    case "CREATED":
      return { ...NONE, lanes: ["FAE"], managers: true };
    case "TO_REPAIR":
      return { lanes: ["FAE", "SALES"], assignees: true, reporter: false, managers: true };
    case "RD_UPDATED":
      return { lanes: ["FAE"], assignees: true, reporter: true, managers: false };
    case "CLOSED":
      return { lanes: [], assignees: true, reporter: true, managers: true };
    case "STUCK":
      return { lanes: STAGE_LANE[ev.stage] ? [STAGE_LANE[ev.stage]!] : [], assignees: true, reporter: false, managers: true };
    case "STAGE": {
      const lane = STAGE_LANE[ev.to];
      const base: FlowAudience = { lanes: lane ? [lane] : [], assignees: true, reporter: false, managers: false };
      // 寄出 / 收件 / 維修完成:回報人也想知道;維修完成與收件也要讓 FAE 知道。
      if (ev.to === "IN_TRANSIT" || ev.to === "RECEIVED") return { ...base, lanes: ["SALES", "FAE"], reporter: true };
      if (ev.to === "REPAIRED") return { ...base, reporter: true };
      return base;
    }
  }
}

export function flowMessage(caseNo: string, summary: string, ev: FlowEvent): string {
  const tail = summary ? `:${summary}` : "";
  switch (ev.type) {
    case "CREATED":
      return `新案件 ${caseNo}${tail}`;
    case "TO_REPAIR":
      return `案件 ${caseNo} 由問題轉成維修(Repair),要安排送回或現場處理${tail}`;
    case "RD_UPDATED":
      return `案件 ${caseNo} 在 Mantis 上有新的回應,請 FAE 看一下並回報結果${tail}`;
    case "CLOSED":
      return `案件 ${caseNo} 已結案${tail}`;
    case "STUCK":
      return `案件 ${caseNo} 在「${ISSUE_STAGE_LABELS[ev.stage]}」已經 ${ev.days} 個工作天沒有進展${tail}`;
    case "STAGE": {
      if (ev.direction === "BACK") return `案件 ${caseNo} 被退回到「${ISSUE_STAGE_LABELS[ev.to]}」${tail}`;
      const lane = STAGE_LANE[ev.to];
      const who = lane ? `輪到 ${ISSUE_LANE_LABELS[lane]} 處理` : "";
      if (ev.to === "RD_WORKING") return `案件 ${caseNo} 需要 RD 協助(已進到「RD 處理中」)${tail}`;
      if (ev.to === "REPAIRED") return `案件 ${caseNo} 維修完成,請 Sales 結案並填維修日報${tail}`;
      return `案件 ${caseNo} 進到「${ISSUE_STAGE_LABELS[ev.to]}」${who ? `,${who}` : ""}${tail}`;
    }
  }
}

/** 卡關:在同一階待了幾個工作天以上。stuckDays <= 0 = 不提醒;結案相關階段不提醒。 */
export function isStuck(stage: IssueStage, daysInStage: number, stuckDays: number, alreadyNotified: boolean): boolean {
  if (stuckDays <= 0 || alreadyNotified) return false;
  if (stage === "CLOSED" || stage === "CLOSING") return false;
  return daysInStage >= stuckDays;
}

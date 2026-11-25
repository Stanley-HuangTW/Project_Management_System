/**
 * ISSUE TRACKER 畫面與 server action 之間傳遞的資料形狀。純型別 + 常數,client 也能 import。
 */
import type { IssueRole } from "@/lib/issueAccess";
import type { IssueStage, StageMove } from "@/lib/issueFlow";

export type IssueKind = "REPAIR" | "ISSUE";
export type IssueStatus = "OPEN" | "TC" | "PC" | "NA";
export type IssuePriority = "P0" | "P1" | "P2" | "P3";
export type IssueLogKind = "RESPONSE" | "ARRANGEMENT" | "SOLUTION" | "NOTE" | "STAGE";

export type IssueUserDto = { id: string; name: string; issueRole: IssueRole | null };

export type IssueCaseRow = {
  id: string;
  caseNo: string;
  kind: IssueKind;
  priority: IssuePriority;
  issueDate: string;
  closeDate: string | null;
  status: IssueStatus;
  customer: string | null;
  product: string | null;
  region: string | null;
  errorType: string | null;
  assignees: { id: string; name: string }[];
  units: string[];
  /** 處理天數(有結案日期才有;工作天或日曆天看系統設定)。 */
  days: number | null;
  /** 還沒解決的案件到今天已經開了幾天。 */
  openDays: number | null;
  locked: boolean;
  rma: boolean;
  reporterName: string | null;
  /** 連到的 Mantis 單號(沒連 = null)。 */
  mantisId: number | null;
  /** 客服維修流程走到哪一階。 */
  stage: IssueStage;
};

export type IssueFilters = {
  q?: string;
  statuses?: IssueStatus[];
  kind?: IssueKind | "";
  priority?: IssuePriority | "";
  productId?: string;
  customerId?: string;
  errorTypeId?: string;
  unitId?: string;
  assigneeId?: string;
  /** 還沒有負責人的案件(「待指派」)。 */
  unassigned?: boolean;
  /** 只看某個流程階段的案件。 */
  stage?: IssueStage | "";
  /** "1" = 只看已連到 Mantis 的;"0" = 只看沒連的。 */
  mantis?: "1" | "0" | "";
  /** 只看我回報或我負責的。 */
  mine?: boolean;
  from?: string;
  to?: string;
  page?: number;
};

export type IssueLogDto = {
  id: string;
  kind: IssueLogKind;
  content: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
};

export type IssueAttachmentDto = {
  id: string;
  fileName: string;
  url: string;
  size: number;
  isLink: boolean;
  uploaderName: string | null;
  createdAt: string;
};

export type IssueWorkEntryDto = {
  id: string;
  date: string;
  hours: number;
  userName: string;
  categoryName: string;
  note: string;
  /** 是我自己登記的(可以刪)。 */
  own: boolean;
};

/** 維修進度:送修方式、物流、各階段日期、配件清點。 */
export type IssueRepairInfo = {
  shipMethod: "MAIL" | "HAND" | null;
  trackingNo: string;
  shippedDate: string | null;
  receivedDate: string | null;
  accessories: string;
  onsiteReplace: boolean;
  repairStartDate: string | null;
  repairDoneDate: string | null;
};

export type IssueCaseDetail = {
  id: string;
  caseNo: string;
  kind: IssueKind;
  priority: IssuePriority;
  customerId: string | null;
  productId: string | null;
  regionId: string | null;
  issueDate: string;
  serialNo: string | null;
  qrCode: string | null;
  description: string;
  behavior: string;
  warrantyId: string | null;
  status: IssueStatus;
  closeDate: string | null;
  deckCount: number | null;
  cutHours: number | null;
  wheelHours: number | null;
  errorTypeId: string | null;
  rma: boolean;
  rmaCuttingDisk: boolean;
  repairOrderNo: string | null;
  assigneeIds: string[];
  unitIds: string[];
  partIds: string[];
  reporterId: string | null;
  reporterName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  createdAt: string;
  firstResponseAt: string | null;
  days: number | null;
  openDays: number | null;
  dayMode: "WORKDAY" | "CALENDAR";
  logs: IssueLogDto[];
  attachments: IssueAttachmentDto[];
  /**
   * 花費工時:連到這個案件的工時(非專案工時,登記即生效)。管理者與負責人看得到全部人的,其他人只看得到自己登記的
   * (scope = "OWN",total 也只算自己的)。
   */
  workHours: { total: number; scope: "ALL" | "OWN"; entries: IssueWorkEntryDto[] };
  /** 登記工時時可選的類別(已啟用、而且開了「可連結案件」的)。 */
  workCategories: { id: string; name: string }[];
  /**
   * Mantis:連到的單號與網址、連線是不是啟用中、這個人能不能操作、
   * 以及哪些欄位現在不能在這裡改(連線啟用、案件已連 Mantis、而且那一類欄位沒開寫回 → 請到 Mantis 改)。
   */
  mantis: {
    id: number | null;
    url: string | null;
    connected: boolean;
    canUse: boolean;
    locked: { status: boolean; priority: boolean; content: boolean };
  };
  /** 客服維修流程:目前階段、進到這階的時間,以及這個人現在可以做的移動。 */
  stage: IssueStage;
  stageAt: string;
  flow: { moves: StageMove[]; canMove: boolean; canConvert: boolean };
  repair: IssueRepairInfo & { canEdit: boolean };
  can: {
    editReport: boolean;
    editHandling: boolean;
    addLog: boolean;
    confirm: boolean;
    claim: boolean;
    manage: boolean;
  };
};

export type IssueCaseInput = {
  kind: IssueKind;
  priority: IssuePriority;
  customerId: string | null;
  productId: string | null;
  regionId: string | null;
  issueDate: string;
  serialNo: string;
  qrCode: string;
  description: string;
  behavior: string;
  warrantyId: string | null;
  status: IssueStatus;
  closeDate: string | null;
  deckCount: number | null;
  cutHours: number | null;
  wheelHours: number | null;
  errorTypeId: string | null;
  rma: boolean;
  rmaCuttingDisk: boolean;
  repairOrderNo: string;
  unitIds: string[];
  partIds: string[];
  /** 只有管理者能改負責人;其他人送來的會被忽略。 */
  assigneeIds: string[];
  /** 新增時同時建立到 Mantis(要有 Mantis 連線,而且是管理者或處理人)。 */
  createInMantis?: boolean;
};

export const ISSUE_PAGE_SIZE = 50;
export const MAX_ISSUE_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_ISSUE_FILES = 30;

export function emptyIssueInput(today: string): IssueCaseInput {
  return {
    kind: "ISSUE",
    priority: "P2",
    customerId: null,
    productId: null,
    regionId: null,
    issueDate: today,
    serialNo: "",
    qrCode: "",
    description: "",
    behavior: "",
    warrantyId: null,
    status: "OPEN",
    closeDate: null,
    deckCount: null,
    cutHours: null,
    wheelHours: null,
    errorTypeId: null,
    rma: false,
    rmaCuttingDisk: false,
    repairOrderNo: "",
    unitIds: [],
    partIds: [],
    assigneeIds: [],
  };
}

export function inputFromDetail(d: IssueCaseDetail): IssueCaseInput {
  return {
    kind: d.kind,
    priority: d.priority,
    customerId: d.customerId,
    productId: d.productId,
    regionId: d.regionId,
    issueDate: d.issueDate,
    serialNo: d.serialNo ?? "",
    qrCode: d.qrCode ?? "",
    description: d.description,
    behavior: d.behavior,
    warrantyId: d.warrantyId,
    status: d.status,
    closeDate: d.closeDate,
    deckCount: d.deckCount,
    cutHours: d.cutHours,
    wheelHours: d.wheelHours,
    errorTypeId: d.errorTypeId,
    rma: d.rma,
    rmaCuttingDisk: d.rmaCuttingDisk,
    repairOrderNo: d.repairOrderNo ?? "",
    unitIds: d.unitIds,
    partIds: d.partIds,
    assigneeIds: d.assigneeIds,
  };
}

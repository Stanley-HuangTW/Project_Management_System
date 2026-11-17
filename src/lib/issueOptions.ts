/**
 * ISSUE TRACKER 的下拉選項類別(原 Sheet「_mgt」分頁的各欄)。純資料,client 也能 import。
 */
export type IssueOptionKind =
  | "CUSTOMER"
  | "PRODUCT"
  | "REGION"
  | "CUSTOMER_TYPE"
  | "WARRANTY"
  | "ERROR_TYPE"
  | "PART"
  | "HANDLER_UNIT";

export const ISSUE_OPTION_KINDS: { kind: IssueOptionKind; label: string; sheetColumn: string; hint: string }[] = [
  { kind: "CUSTOMER", label: "客戶", sheetColumn: "_mgt A「客戶代號」", hint: "案件的 Customer 下拉。可設定客戶的預設地區與客戶型態。" },
  { kind: "PRODUCT", label: "產品型號", sheetColumn: "_mgt B「產品型號」", hint: "案件的 Model 下拉(M1、M1S、M2、CS…)。統整頁依這個分產品。" },
  { kind: "REGION", label: "地區", sheetColumn: "_mgt C「地區」", hint: "案件的 Region 下拉。" },
  { kind: "CUSTOMER_TYPE", label: "客戶型態", sheetColumn: "_mgt D「客戶型態」", hint: "客戶的屬性(Commercial、Residential、Lease…)。" },
  { kind: "WARRANTY", label: "保固狀態", sheetColumn: "_mgt E「保固狀態」", hint: "案件的 Warranty 下拉(IN、OUT、ABUSE、TBC)。" },
  { kind: "ERROR_TYPE", label: "問題類型", sheetColumn: "_mgt F「Error Type」", hint: "名稱開頭的代碼就是大類:SW 軟體、HW 硬體、CN 查無問題/操作、LM 設計限制、OP 安裝/操作錯誤。例:HW02-刀盤馬達異常。" },
  { kind: "PART", label: "更換零件", sheetColumn: "_mgt H「Repair Parts」+ G 簡稱", hint: "案件的「更換重要零件」下拉。名稱填完整料號/規格,簡稱用來在統整頁歸類。" },
  { kind: "HANDLER_UNIT", label: "處理單位", sheetColumn: "案件表 U「處理單位」", hint: "案件歸屬的處理單位(SW、HW、QA…),一個案件可以有多個。" },
];

export function issueOptionKindLabel(kind: IssueOptionKind): string {
  return ISSUE_OPTION_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export type IssueOptionDto = {
  id: string;
  kind: IssueOptionKind;
  name: string;
  shortName: string | null;
  defaultRegionId: string | null;
  customerTypeId: string | null;
  active: boolean;
  /** 被多少案件用到(管理頁顯示;用過的只能停用不能刪)。 */
  usage: number;
};

/** 新增案件時預設要帶的零件類別的簡稱,沒有簡稱就用名稱本身。 */
export function partLabel(o: { name: string; shortName: string | null }): string {
  return o.shortName ? `${o.shortName} — ${o.name}` : o.name;
}

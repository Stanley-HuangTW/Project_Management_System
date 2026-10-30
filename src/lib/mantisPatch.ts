/**
 * 在本系統改了一筆 Mantis 同步來的問題之後,要送給 Mantis 的是什麼(PATCH /issues/{id} 的內容)。
 * 純邏輯:不打 Mantis、不碰資料庫。不需要寫的(欄位沒變、Mantis 上已經是那個值、這個狀態不寫回)一律不放進去,
 * 這樣就算兩邊用不同的字眼,也不會把 Mantis 上沒人動過的欄位又寫一遍。
 */
import type { RiskStatus } from "@prisma/client";
import { formatDueDate, type MantisIssue, type MantisUser } from "./mantis";
import { matchMantisPerson } from "./mantisPeople";
import {
  WRITE_FIELD_LABELS,
  impactFromMantis,
  isWriteEnabled,
  severityToMantis,
  statusFromMantis,
  statusToMantis,
  type MantisMapping,
  type WriteField,
} from "./mantisMapping";

/** 這一次要改的欄位;沒給的就是沒改。 */
export type MantisChange = {
  status?: RiskStatus;
  /** 新的負責人(本系統使用者);null = 取消指派。 */
  owner?: { id: string; name: string; email: string } | null;
  impact?: number;
  /** Mantis 優先權的編號。 */
  priorityId?: number;
  title?: string;
  /** 說明本文(不含接在後面的 Mantis 備註區塊)。 */
  description?: string;
  dueDate?: string | null;
};

export type MantisPatch = { payload: Record<string, unknown>; summary: string[] };

const SUMMARY_MAX = 128;
const norm = (s: string | null | undefined) => (s ?? "").replace(/\r\n/g, "\n").trim();
const refText = (list: { id?: number; name?: string; label?: string } | undefined) => list?.label || list?.name || "—";

/** 本系統的負責人 → Mantis 使用者編號:先看手動對應,再用 Email 比對同步時收集到的 Mantis 使用者。 */
export function resolveMantisHandler(
  owner: { id: string; name: string; email: string },
  mapping: MantisMapping,
  users: MantisUser[]
): { id: number } | { error: string } {
  const found = matchMantisPerson(owner, users, mapping.handlerOverrides);
  if (found) return { id: found.user.id };
  return {
    error: `找不到「${owner.name}」對應的 Mantis 帳號(Email、姓名、帳號名稱都比對不到)。請管理者到系統設定的「欄位對應與寫回」→「處理人對應」手動指定。`,
  };
}

export function buildMantisPatch(
  change: MantisChange,
  ctx: { mapping: MantisMapping; issue: MantisIssue; mantisUsers: MantisUser[] }
): MantisPatch | { error: string } {
  const { mapping, issue } = ctx;
  const payload: Record<string, unknown> = {};
  const summary: string[] = [];
  const locked = (field: WriteField) => ({
    error: `這個連線沒有開啟寫回「${WRITE_FIELD_LABELS[field]}」,這個欄位請到 Mantis 修改。`,
  });

  // 狀態:這個狀態沒設寫回、或 Mantis 上現在的狀態在這邊本來就算同一種,就不動 Mantis。
  if (change.status !== undefined) {
    const target = statusToMantis(mapping, change.status);
    if (target && statusFromMantis(mapping, issue.status?.id) !== change.status) {
      if (!isWriteEnabled(mapping, "status")) return locked("status");
      payload.status = { id: target.id, name: target.name };
      if (target.id >= 80 && mapping.resolutionOut) payload.resolution = { id: mapping.resolutionOut.id, name: mapping.resolutionOut.name };
      summary.push(`狀態:${refText(issue.status)} → ${target.name}`);
    }
  }

  if (change.owner !== undefined) {
    const currentId = issue.handler?.id ?? null;
    if (change.owner === null) {
      if (currentId !== null) {
        return { error: "Mantis 的 API 不能清掉處理人,要取消指派請到 Mantis 上操作。" };
      }
    } else {
      const target = resolveMantisHandler(change.owner, mapping, ctx.mantisUsers);
      if ("error" in target) return target;
      if (target.id !== currentId) {
        if (!isWriteEnabled(mapping, "handler")) return locked("handler");
        payload.handler = { id: target.id };
        summary.push(`處理人:${issue.handler?.real_name || issue.handler?.name || "未指派"} → ${change.owner.name}`);
      }
    }
  }

  if (change.impact !== undefined) {
    const target = severityToMantis(mapping, change.impact);
    if (target && impactFromMantis(mapping, issue.severity?.id) !== change.impact) {
      if (!isWriteEnabled(mapping, "severity")) return locked("severity");
      payload.severity = { id: target.id, name: target.name };
      summary.push(`嚴重度:${refText(issue.severity)} → ${target.name}`);
    }
  }

  if (change.priorityId !== undefined && change.priorityId !== issue.priority?.id) {
    if (!isWriteEnabled(mapping, "severity")) return locked("severity");
    const found = mapping.enums.priority.find((e) => e.id === change.priorityId);
    payload.priority = { id: change.priorityId, ...(found ? { name: found.name } : {}) };
    summary.push(`優先權:${refText(issue.priority)} → ${found?.name ?? `#${change.priorityId}`}`);
  }

  if (change.title !== undefined && norm(change.title) !== norm(issue.summary)) {
    if (!isWriteEnabled(mapping, "content")) return locked("content");
    const title = norm(change.title);
    if (!title) return { error: "Mantis 的摘要不能留空。" };
    if (title.length > SUMMARY_MAX) return { error: `Mantis 的摘要最多 ${SUMMARY_MAX} 字。` };
    payload.summary = title;
    summary.push("摘要");
  }

  if (change.description !== undefined && norm(change.description) !== norm(issue.description)) {
    if (!isWriteEnabled(mapping, "content")) return locked("content");
    const description = norm(change.description);
    if (!description) return { error: "Mantis 的說明不能留空。" };
    payload.description = description;
    summary.push("說明");
  }

  if (change.dueDate !== undefined && (change.dueDate ?? null) !== formatDueDate(issue.due_date)) {
    if (!isWriteEnabled(mapping, "content")) return locked("content");
    if (change.dueDate === null) return { error: "Mantis 的 API 不能清掉到期日,要清除請到 Mantis 上操作。" };
    payload.due_date = change.dueDate;
    summary.push(`到期日:${formatDueDate(issue.due_date) ?? "未設"} → ${change.dueDate}`);
  }

  return { payload, summary };
}

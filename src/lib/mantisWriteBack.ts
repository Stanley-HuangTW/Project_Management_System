import type { RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secretBox";
import { toTaipei } from "@/lib/googleCalendar";
import { mapMantisIssue, resolveLocalStatus, type MantisUser } from "@/lib/mantis";
import { parseMapping } from "@/lib/mantisMapping";
import { buildMantisPatch, type MantisChange } from "@/lib/mantisPatch";
import { MantisError, fetchMantisIssue, patchMantisIssue, riskFieldsFromMapped } from "@/lib/mantisSync";

/**
 * 在本系統改了 Mantis 同步來的問題,存檔當下就寫回 Mantis(寫回的欄位與對應見 mantisMapping.ts)。
 *
 * 順序:先讀 Mantis 現況,發現這一筆在 Mantis 上被別人改過(updated_at 跟本系統記的不同)就擋下,
 * 不蓋掉對方;再只送有變的欄位;Mantis 拒絕就整個回錯誤,呼叫端什麼都不存;
 * 成功之後讀回最新的問題,用它更新本系統那一列,兩邊一致。錯誤一律用回傳值帶回(正式版不會顯示丟出的訊息)。
 */
export type PushResult =
  | { ok: true; wrote: boolean; summary: string[]; note?: string }
  | { error: string };

export async function pushMantisChanges(riskId: string, change: MantisChange): Promise<PushResult> {
  const risk = await prisma.riskEntry.findUnique({
    where: { id: riskId },
    select: { id: true, boardId: true, mantisId: true, mantisUpdatedAt: true, status: true },
  });
  if (!risk || risk.mantisId === null) return { error: "這一筆不是從 Mantis 同步來的" };
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId: risk.boardId } });
  if (!conn) return { error: "這個看板已經沒有 Mantis 連線" };
  const mapping = parseMapping(conn.mapping);
  if (!mapping.writeBack.enabled) return { error: "這個連線沒有開啟寫回 Mantis,要修改請到 Mantis" };
  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return { error: "Mantis 的 API token 解不開,請管理者重新輸入 token" };

  let current;
  try {
    current = await fetchMantisIssue(conn.baseUrl, token, risk.mantisId);
  } catch (err) {
    return { error: err instanceof MantisError ? err.message : "讀取 Mantis 失敗" };
  }
  if (!current) return { error: "Mantis 上找不到這一筆問題(可能已被刪除或搬走),請先按「立即同步」" };

  // 別人剛在 Mantis 上改過:先同步、看過最新內容再改,不要蓋掉對方。
  const theirs = current.updated_at ? Date.parse(current.updated_at) : NaN;
  if (risk.mantisUpdatedAt && !Number.isNaN(theirs) && theirs !== risk.mantisUpdatedAt.getTime()) {
    const when = toTaipei(theirs);
    const hhmm = `${String(Math.floor(when.minute / 60)).padStart(2, "0")}:${String(when.minute % 60).padStart(2, "0")}`;
    return {
      error: `Mantis 上這一筆在 ${when.date} ${hhmm} 被改過,本系統還沒同步到。為了不蓋掉那個修改,這次沒有寫回——請管理者到系統設定按「立即同步」,看過最新內容再改一次。`,
    };
  }

  const mantisUsers = Array.isArray(conn.users) ? (conn.users as MantisUser[]) : [];
  const patch = buildMantisPatch(change, { mapping, issue: current, mantisUsers });
  if ("error" in patch) return patch;
  if (Object.keys(patch.payload).length === 0) return { ok: true, wrote: false, summary: [] };

  try {
    await patchMantisIssue(conn.baseUrl, token, risk.mantisId, patch.payload);
  } catch (err) {
    return { error: `寫回 Mantis 失敗,這次的修改沒有存:${err instanceof MantisError ? err.message : "未知的錯誤"}` };
  }

  // 讀回最新的問題,本系統那一列跟 Mantis 一致(Mantis 可能順手改了別的,例如指派後自動轉成 assigned)。
  let refreshed;
  try {
    refreshed = await fetchMantisIssue(conn.baseUrl, token, risk.mantisId);
  } catch {
    refreshed = null;
  }
  if (!refreshed) {
    return {
      ok: true,
      wrote: true,
      summary: patch.summary,
      note: "已寫回 Mantis,但讀回最新內容失敗;本系統的畫面會在下一次同步(或按「立即同步」)後更新。",
    };
  }
  const mapped = mapMantisIssue(refreshed, conn.baseUrl, mapping);
  const owner = mapped.handlerEmail
    ? await prisma.user.findFirst({ where: { email: { equals: mapped.handlerEmail, mode: "insensitive" } }, select: { id: true } })
    : null;
  const intended: RiskStatus = change.status ?? risk.status;
  const status = resolveLocalStatus(intended, mapped.status, mapped.mantisStatusId, mapping.statusOut.PENDING_REVIEW?.id);
  await prisma.riskEntry.update({
    where: { id: risk.id },
    data: riskFieldsFromMapped(mapped, owner?.id ?? null, conn.issueItemId, status),
  });
  return { ok: true, wrote: true, summary: patch.summary };
}

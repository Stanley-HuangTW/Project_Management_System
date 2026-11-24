import type { Prisma } from "@prisma/client";
import { casePeriod, formatCaseNo } from "@/lib/issueCase";

/**
 * 在交易裡取下一個 Case No:每個月一列計數器,INSERT … ON CONFLICT DO UPDATE … RETURNING 在資料庫裡原子加一(列鎖),
 * 並發不會拿到同一號;案件寫入失敗時交易一起退回,不會留下空號。手動新增、Mantis 同步建立的案件都走這一支。
 * 不在 "use server" 檔案裡:那裡的匯出都會變成對外的 Server Action。
 */
export async function allocateCaseNo(tx: Prisma.TransactionClient, issueDate: string): Promise<string> {
  const period = casePeriod(issueDate);
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "IssueCaseCounter" ("period", "last") VALUES (${period}, 1)
    ON CONFLICT ("period") DO UPDATE SET "last" = "IssueCaseCounter"."last" + 1
    RETURNING "last"`;
  return formatCaseNo(issueDate, Number(rows[0].last));
}

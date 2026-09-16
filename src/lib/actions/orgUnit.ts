"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/activityLog";
import { checkUnitCode } from "@/lib/orgUnits";
import { loadOrgUnits } from "@/lib/orgUnitsServer";

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new Error("只有管理者能設定組織單位");
  return session;
}

/** 改動之後要重畫的幾頁 —— 單位會出現在設定、使用者、每一塊看板上。 */
function revalidateUnits() {
  revalidatePath("/settings");
  revalidatePath("/users");
  revalidatePath("/boards", "layout");
  revalidatePath("/dashboard");
}

export async function createOrgUnit(
  rawCode: string,
  rawLabel: string
): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const checked = checkUnitCode(rawCode);
  if (!checked.ok) return { error: checked.reason };
  const label = rawLabel.trim() || checked.code;

  const existing = await prisma.orgUnit.findUnique({ where: { code: checked.code } });
  if (existing) return { error: `「${checked.code}」已經有了` };

  const last = await prisma.orgUnit.findFirst({ orderBy: { order: "desc" } });
  await prisma.orgUnit.create({
    data: { code: checked.code, label, order: (last?.order ?? -1) + 1 },
  });

  await logAudit("SETTINGS", session.userId, `新增組織單位 ${checked.code}(${label})`);
  revalidateUnits();
  return {};
}

/**
 * 改名。code 也能改 —— 外鍵是 ON UPDATE CASCADE,引用它的人月、月薪、
 * 名額會一起跟著改,不會被留在一個沒人認得的代號底下。
 */
export async function renameOrgUnit(
  code: string,
  rawLabel: string,
  rawNewCode?: string
): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const unit = await prisma.orgUnit.findUnique({ where: { code } });
  if (!unit) return { error: "找不到這個單位" };

  const label = rawLabel.trim();
  if (!label) return { error: "名稱不可為空" };

  let newCode = code;
  if (rawNewCode !== undefined && rawNewCode.trim()) {
    const checked = checkUnitCode(rawNewCode);
    if (!checked.ok) return { error: checked.reason };
    if (checked.code !== code) {
      const clash = await prisma.orgUnit.findUnique({ where: { code: checked.code } });
      if (clash) return { error: `「${checked.code}」已經有了` };
      newCode = checked.code;
    }
  }

  await prisma.orgUnit.update({ where: { code }, data: { code: newCode, label } });

  const what = newCode === code ? `${code} 改名為「${label}」` : `${code} → ${newCode}(${label})`;
  await logAudit("SETTINGS", session.userId, `組織單位 ${what}`);
  revalidateUnits();
  return {};
}

/**
 * 刪一個單位。
 *
 * 有人月、有月薪、有名額掛在上面就不給刪 —— 資料庫的外鍵本來就會擋,但
 * 那會丟出一句看不懂的錯誤。先數出來,告訴使用者是哪幾樣卡住。
 */
export async function deleteOrgUnit(code: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const unit = await prisma.orgUnit.findUnique({ where: { code } });
  if (!unit) return { error: "找不到這個單位" };

  const [plans, slots, rate, users] = await Promise.all([
    prisma.labourPlan.count({ where: { discipline: code } }),
    prisma.labourSlot.count({ where: { discipline: code } }),
    prisma.disciplineRate.findUnique({ where: { discipline: code } }),
    prisma.user.count({ where: { discipline: code } }),
  ]);

  const blockers: string[] = [];
  if (plans > 0) blockers.push(`${plans} 筆人力規劃`);
  if (slots > 0) blockers.push(`${slots} 個人力名額`);
  if (rate) blockers.push("已設定的標準月薪");
  if (blockers.length > 0) {
    return { error: `還有 ${blockers.join("、")} 用到「${code}」,要先改掉才能刪。` };
  }

  // 人身上的單位是 SET NULL,刪得掉,但使用者應該先知道會清掉幾個人的歸屬。
  await prisma.orgUnit.delete({ where: { code } });

  const note = users > 0 ? `,${users} 位使用者的所屬單位一併清空` : "";
  await logAudit("SETTINGS", session.userId, `刪除組織單位 ${code}(${unit.label})${note}`);
  revalidateUnits();
  return {};
}

/** 往上或往下挪一格。表格欄位的順序就是這個順序。 */
export async function moveOrgUnit(code: string, direction: "up" | "down"): Promise<{ error?: string }> {
  await requireAdmin();
  const units = await loadOrgUnits();
  const index = units.findIndex((u) => u.code === code);
  if (index === -1) return { error: "找不到這個單位" };

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= units.length) return {};

  // 整排重寫比交換兩個 order 穩:資料庫裡的 order 不保證沒有重複值。
  const reordered = [...units];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  await prisma.$transaction(
    reordered.map((u, i) => prisma.orgUnit.update({ where: { code: u.code }, data: { order: i } }))
  );

  revalidateUnits();
  return {};
}

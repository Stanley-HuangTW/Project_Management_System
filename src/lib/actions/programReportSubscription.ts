"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/activityLog";

/**
 * 週報分發設定跟專案群組本身同一個權限規則(program.ts 的 requireAdmin)：
 * 決定寄給誰、寄什麼,影響範圍不只自己,不比管理群組本身的門檻低。
 */
async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new Error("權限不足:僅管理者可以設定專案週報分發");
  return session;
}

export type ReportRecipientRow = {
  id: string;
  /** 是現有帳號的話,這個人的 userId——下拉選單要靠它排除已經加過的人。 */
  userId: string | null;
  label: string;
  isUser: boolean;
};

export type ProgramReportSubscriptionRow = {
  programId: string;
  programName: string;
  upcomingDays: number;
  includeSummary: boolean;
  includeProgramDiff: boolean;
  includeDepartments: boolean;
  includeActivity: boolean;
  recipients: ReportRecipientRow[];
};

const DEFAULTS = {
  upcomingDays: 7,
  includeSummary: true,
  includeProgramDiff: true,
  includeDepartments: true,
  includeActivity: true,
};

/** 每個專案群組一列——還沒設定過的專案群組回預設值,不是不存在。 */
export async function listProgramReportSubscriptions(): Promise<ProgramReportSubscriptionRow[]> {
  await requireAdmin();
  const programs = await prisma.program.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      reportSubscription: {
        include: { recipients: { include: { user: { select: { name: true } } } } },
      },
    },
  });

  return programs.map((program) => {
    const sub = program.reportSubscription;
    return {
      programId: program.id,
      programName: program.name,
      upcomingDays: sub?.upcomingDays ?? DEFAULTS.upcomingDays,
      includeSummary: sub?.includeSummary ?? DEFAULTS.includeSummary,
      includeProgramDiff: sub?.includeProgramDiff ?? DEFAULTS.includeProgramDiff,
      includeDepartments: sub?.includeDepartments ?? DEFAULTS.includeDepartments,
      includeActivity: sub?.includeActivity ?? DEFAULTS.includeActivity,
      recipients:
        sub?.recipients.map((r) => ({
          id: r.id,
          userId: r.userId,
          label: r.user?.name ?? r.email ?? "",
          isUser: !!r.userId,
        })) ?? [],
    };
  });
}

/** 第一次改設定才建這一列;options 沒給的欄位維持原樣(或預設值)。 */
async function ensureSubscription(programId: string) {
  return prisma.programReportSubscription.upsert({
    where: { programId },
    create: { programId },
    update: {},
  });
}

export async function setProgramReportOptions(
  programId: string,
  options: Partial<{
    upcomingDays: number;
    includeSummary: boolean;
    includeProgramDiff: boolean;
    includeDepartments: boolean;
    includeActivity: boolean;
  }>
): Promise<{ error?: string }> {
  const session = await requireAdmin();
  if (options.upcomingDays !== undefined && (options.upcomingDays < 1 || options.upcomingDays > 90)) {
    return { error: "接下來幾天要介於 1 到 90 之間" };
  }
  const sub = await ensureSubscription(programId);
  await prisma.programReportSubscription.update({ where: { id: sub.id }, data: options });
  await logAudit("SETTINGS", session.userId, `調整專案週報分發的內容範圍`);
  revalidatePath("/settings");
  return {};
}

export async function addProgramReportRecipient(
  programId: string,
  input: { userId: string } | { email: string }
): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const sub = await ensureSubscription(programId);

  if ("email" in input) {
    const email = input.email.trim();
    if (!email || !email.includes("@")) return { error: "請輸入有效的 email" };
    await prisma.programReportRecipient.create({ data: { subscriptionId: sub.id, email } });
    await logAudit("SETTINGS", session.userId, `專案週報分發新增收件人:${email}`);
  } else {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { name: true } });
    if (!user) return { error: "找不到這個使用者" };
    const existing = await prisma.programReportRecipient.findUnique({
      where: { subscriptionId_userId: { subscriptionId: sub.id, userId: input.userId } },
    });
    if (existing) return { error: `「${user.name}」已經在收件名單裡了` };
    await prisma.programReportRecipient.create({
      data: { subscriptionId: sub.id, userId: input.userId },
    });
    await logAudit("SETTINGS", session.userId, `專案週報分發新增收件人:${user.name}`);
  }

  revalidatePath("/settings");
  return {};
}

export async function removeProgramReportRecipient(recipientId: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const recipient = await prisma.programReportRecipient.findUnique({
    where: { id: recipientId },
    include: { user: { select: { name: true } } },
  });
  if (!recipient) return { error: "找不到這個收件人" };
  await prisma.programReportRecipient.delete({ where: { id: recipientId } });
  await logAudit(
    "SETTINGS",
    session.userId,
    `專案週報分發移除收件人:${recipient.user?.name ?? recipient.email}`
  );
  revalidatePath("/settings");
  return {};
}

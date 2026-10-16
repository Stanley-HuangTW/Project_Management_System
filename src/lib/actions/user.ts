"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { wouldCreateCycle } from "@/lib/orgChart";
import type { Discipline } from "@/lib/labourPlan";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { requireSession } from "@/lib/session";
import { resyncBoardLabour } from "@/lib/actions/labourSheet";
import type { UserRole } from "@prisma/client";

export async function listUsers() {
  await requireSession();
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      createdAt: true,
      supervisorId: true,
      supervisor: { select: { id: true, name: true } },
      orgNodeId: true,
      lockedUntil: true,
      hourlyRate: true,
      discipline: true,
      monthlySalary: true,
      canViewAllTimesheets: true,
      timesheetNoApproval: true,
    },
    orderBy: { order: "asc" },
  });
  // Decimal is a class instance; a client component can only be handed plain
  // values, so the rates cross that boundary as numbers.
  return users.map((user) => ({
    ...user,
    hourlyRate: user.hourlyRate ? Number(user.hourlyRate) : null,
    monthlySalary: user.monthlySalary ? Number(user.monthlySalary) : null,
  }));
}

/**
 * 所屬單位。人力成本與人力規劃都照這個歸戶,所以它跟費率一樣是自己一支,
 * 不必為了改它把整個編輯表單打開。
 */
export async function updateUserDiscipline(userId: string, discipline: Discipline | null) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以設定所屬單位");
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, discipline: true },
  });
  await prisma.user.update({ where: { id: userId }, data: { discipline } });
  await logAudit(
    "COST",
    session.userId,
    `${target?.name ?? userId} 的所屬單位:${target?.discipline ?? "(未設定)"} → ${discipline ?? "(未設定)"}`
  );
  revalidatePath("/users");
}

/**
 * 指定某個人可以檢視全部成員的工時統計。沒勾的主管只看得到直屬部屬,
 * 見 timesheet.ts 的 canViewTimesheetOf。
 */
export async function updateUserTimesheetAccess(userId: string, canViewAll: boolean) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以設定工時檢視權限");
  }
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!target) throw new Error("找不到使用者");

  await prisma.user.update({ where: { id: userId }, data: { canViewAllTimesheets: canViewAll } });
  await logAudit(
    "SETTINGS",
    session.userId,
    `${target.name} ${canViewAll ? "可以檢視全部成員的工時" : "不再能檢視全部成員的工時"}`
  );
  revalidatePath("/users");
}

/**
 * 設定某個人的工時免審核:之後登記的專案工時與對應專案的會議工時直接生效;目前還在待審的
 * 一併視為核准(註記「免審核」),不留下一堆沒人處理的待審。
 */
export async function updateUserTimesheetNoApproval(userId: string, noApproval: boolean) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以設定工時免審核");
  }
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!target) throw new Error("找不到使用者");

  await prisma.user.update({ where: { id: userId }, data: { timesheetNoApproval: noApproval } });
  let approved = 0;
  if (noApproval) {
    const now = new Date();
    const [a, b] = await Promise.all([
      prisma.timeEntry.updateMany({
        where: { userId, status: "PENDING" },
        data: { status: "APPROVED", decidedAt: now, decisionNote: "免審核" },
      }),
      prisma.activityTimeEntry.updateMany({
        where: { userId, status: "PENDING" },
        data: { status: "APPROVED", decidedAt: now, decisionNote: "免審核" },
      }),
    ]);
    approved = a.count + b.count;
  }
  await logAudit(
    "SETTINGS",
    session.userId,
    `${target.name} 的工時${noApproval ? `設為免審核(待審的 ${approved} 筆一併視為核准)` : "恢復為需要審核"}`
  );
  revalidatePath("/users");
  revalidatePath("/approvals");
  revalidatePath("/timesheet");
}

/** 這個人被指到的人力表名額所在的看板。他的月薪(或他這個人)一變,那些看板的人力預算要重算。 */
async function boardsWithSlotsOf(userId: string): Promise<string[]> {
  const slots = await prisma.labourSlot.findMany({ where: { userId }, select: { boardId: true }, distinct: ["boardId"] });
  return slots.map((s) => s.boardId);
}

/**
 * 月薪。時薪有填的時候仍然優先,所以填月薪不會動到現有的實際工時成本 ——
 * 換算順序見 labourPlan.ts 的 effectiveHourlyRate。
 *
 * 人力表裡指到這個人的名額,人力預算改用他的月薪算(沒設月薪的名額維持單位標準月薪),
 * 所以月薪一改,那些看板的人力預算(階段預算裡「人力」那一列)就跟著重算。
 */
export async function updateUserMonthlySalary(userId: string, salary: number | null) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以設定月薪");
  }
  if (salary !== null && (!Number.isFinite(salary) || salary < 0)) {
    throw new Error("月薪必須是 0 或正數");
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, monthlySalary: true },
  });
  await prisma.user.update({ where: { id: userId }, data: { monthlySalary: salary } });
  const boardIds = await boardsWithSlotsOf(userId);
  for (const boardId of boardIds) await resyncBoardLabour(boardId);
  await logAudit(
    "COST",
    session.userId,
    `${target?.name ?? userId} 的月薪:${target?.monthlySalary ? Number(target.monthlySalary) : "(未設定)"} → ${salary ?? "(未設定)"}${boardIds.length > 0 ? `,連動重算 ${boardIds.length} 塊看板的人力預算` : ""}`
  );
  revalidatePath("/users");
  revalidatePath("/dashboard");
}

/**
 * 每小時人力成本。Kept as its own action rather than another parameter on
 * updateUser: a rate changes on its own schedule (a promotion, a new year's
 * rates) and should not need the whole edit form opened to change it.
 */
export async function updateUserHourlyRate(userId: string, rate: number | null) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以設定費率");
  }
  if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
    throw new Error("費率必須是 0 或正數");
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, hourlyRate: true },
  });
  await prisma.user.update({ where: { id: userId }, data: { hourlyRate: rate } });
  // 費率直接決定 EVM 的人力成本,改動必須留得住。
  await logAudit(
    "COST",
    session.userId,
    `${target?.name ?? userId} 的費率:${target?.hourlyRate ? Number(target.hourlyRate) : "(未設定)"} → ${rate ?? "(未設定)"}`
  );
  revalidatePath("/users");
}

/**
 * 一旦組織圖可以超過兩階,「指自己」就不再是唯一會繞回來的指派 ——
 * A→B→A 也是,而且成環的那一群人會從每個人的下轄範圍裡消失。
 */
async function requireNoCycle(userId: string, supervisorId: string | null) {
  if (!supervisorId) return;
  const users = await prisma.user.findMany({ select: { id: true, supervisorId: true } });
  if (wouldCreateCycle(users, userId, supervisorId)) {
    const who = await prisma.user.findUnique({ where: { id: supervisorId }, select: { name: true } });
    throw new Error(
      userId === supervisorId
        ? "不可指定自己為主管"
        : `不可指定「${who?.name ?? supervisorId}」為主管:他在這個人的下轄範圍裡,會繞成一圈`
    );
  }
}

export async function createUser(
  name: string,
  email: string,
  password: string,
  role: UserRole,
  supervisorId: string | null
) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以新增使用者");
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedName || !trimmedEmail || !password) {
    throw new Error("姓名、Email、密碼皆為必填");
  }
  if (password.length < 8) {
    throw new Error("密碼至少需要 8 個字元");
  }

  const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } });
  if (existing) {
    throw new Error("此 Email 已被使用");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const maxOrder = await prisma.user.aggregate({ _max: { order: true } });
  await prisma.user.create({
    data: {
      name: trimmedName,
      email: trimmedEmail,
      passwordHash,
      role,
      // 主管本來一律被寫成 null,所以組織圖鎖死在剛好兩階。現在誰都可以有
      // 自己的主管,階層要幾階由填法決定。
      supervisorId,
      order: (maxOrder._max.order ?? -1) + 1,
    },
  });

  revalidatePath("/users");
}

export async function updateUser(
  userId: string,
  name: string,
  email: string,
  role: UserRole,
  supervisorId: string | null
) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以修改使用者");
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedName || !trimmedEmail) {
    throw new Error("姓名、Email 皆為必填");
  }
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    throw new Error("找不到使用者");
  }
  // 掛在組織架構圖上的人,所屬主管由架構圖決定,這裡改不動。
  const orgManaged = !!target.orgNodeId;
  if (!orgManaged) await requireNoCycle(userId, supervisorId);

  const emailOwner = await prisma.user.findUnique({ where: { email: trimmedEmail } });
  if (emailOwner && emailOwner.id !== userId) {
    throw new Error("此 Email 已被使用");
  }

  if (target.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      throw new Error("至少需保留一位管理者");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        name: trimmedName,
        email: trimmedEmail,
        role,
        supervisorId: orgManaged ? target.supervisorId : supervisorId,
      },
    });
    // 不再帶人的話,他的部屬往上接一層,而不是全部變成「未設定」—— 兩階
    // 的時候上面沒有人可以接,所以只能清空;現在有了,清空等於把一整支
    // 從組織圖上砍掉。
    if (target.role === "SUPERVISOR" && role === "MEMBER") {
      await tx.user.updateMany({
        where: { supervisorId: userId },
        data: { supervisorId },
      });
    }
  });

  revalidatePath("/users");
}

export async function deleteUser(userId: string) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以刪除使用者");
  }
  if (session.userId === userId) {
    throw new Error("不可刪除自己的帳號");
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    throw new Error("找不到使用者");
  }

  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      throw new Error("至少需保留一位管理者");
    }
  }

  const [boardCount, commentCount, attachmentCount] = await Promise.all([
    prisma.board.count({ where: { ownerId: userId } }),
    prisma.comment.count({ where: { authorId: userId } }),
    prisma.attachment.count({ where: { uploaderId: userId } }),
  ]);
  if (boardCount > 0) {
    throw new Error(`此使用者擁有 ${boardCount} 個看板,請先轉移看板擁有者或刪除該看板後再刪除使用者`);
  }
  if (commentCount > 0 || attachmentCount > 0) {
    throw new Error("此使用者仍有留言或上傳檔案紀錄,無法刪除");
  }

  // 被指到的人力表名額會變成沒指定人(外鍵 SetNull),它的人力預算就改回單位標準月薪。
  const slotBoardIds = await boardsWithSlotsOf(userId);
  await prisma.user.delete({ where: { id: userId } });
  for (const boardId of slotBoardIds) await resyncBoardLabour(boardId);

  revalidatePath("/users");
}

export async function reorderUsers(orderedUserIds: string[]) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以調整使用者順序");
  }

  await prisma.$transaction(
    orderedUserIds.map((id, index) =>
      prisma.user.update({ where: { id }, data: { order: index } })
    )
  );

  revalidatePath("/users");
}

export async function updateUserSupervisor(
  userId: string,
  supervisorId: string | null
) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以設定所屬主管");
  }
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { orgNodeId: true } });
  if (target?.orgNodeId) {
    throw new Error("這個人掛在組織架構圖上,所屬主管由架構圖決定,請到「組織架構圖」修改");
  }
  await requireNoCycle(userId, supervisorId);

  await prisma.user.update({
    where: { id: userId },
    data: { supervisorId },
  });

  revalidatePath("/users");
}

export async function updateUserAvatar(userId: string, avatarUrl: string | null) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以設定使用者頭像");
  }
  if (avatarUrl && avatarUrl.length > 2_000_000) {
    throw new Error("圖片檔案過大,請使用較小的圖片");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
  });

  revalidatePath("/users");
  revalidatePath("/boards");
  revalidatePath("/dashboard");
}

export async function adminResetUserPassword(userId: string, newPassword: string) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以重設使用者密碼");
  }
  if (newPassword.length < 8) {
    throw new Error("密碼至少需要 8 個字元");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      resetToken: null,
      resetTokenExpiresAt: null,
    },
  });

  revalidatePath("/users");
}

/** Self-service version of updateUserAvatar — any logged-in user may set
 *  their own photo, no ADMIN check. */
export async function updateOwnAvatar(avatarUrl: string | null) {
  const session = await requireSession();
  if (session.impersonatorId) throw new Error("以別人的身分檢視時,不能更換對方的照片");
  if (avatarUrl && avatarUrl.length > 2_000_000) {
    throw new Error("圖片檔案過大,請使用較小的圖片");
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: { avatarUrl },
  });

  revalidatePath("/users");
  revalidatePath("/boards");
  revalidatePath("/dashboard");
}

/** Self-service password change — unlike adminResetUserPassword, requires
 *  the current password so a briefly-unattended session can't be used to
 *  silently lock the real owner out. */
export async function updateOwnPassword(currentPassword: string, newPassword: string) {
  const session = await requireSession();
  if (session.impersonatorId) throw new Error("以別人的身分檢視時,不能變更對方的密碼");
  if (newPassword.length < 8) {
    throw new Error("新密碼至少需要 8 個字元");
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    throw new Error("找不到使用者");
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new Error("目前密碼不正確");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: session.userId },
    data: {
      passwordHash,
      resetToken: null,
      resetTokenExpiresAt: null,
    },
  });
}

export async function unlockUser(userId: string) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("只有管理員可以解除帳號鎖定");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  revalidatePath("/users");
}

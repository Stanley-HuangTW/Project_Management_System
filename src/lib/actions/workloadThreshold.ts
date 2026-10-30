"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";

export async function getWorkloadThreshold() {
  const threshold = await prisma.workloadThreshold.findUnique({ where: { id: "global" } });
  if (threshold) return threshold;
  return {
    id: "global",
    greenMax: 30,
    yellowMax: 70,
    greenColor: "#00c875",
    yellowColor: "#fdab3d",
    redColor: "#e2445c",
    updatedAt: new Date(),
  };
}

export async function updateWorkloadThreshold(data: {
  greenMax: number;
  yellowMax: number;
  greenColor: string;
  yellowColor: string;
  redColor: string;
}) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  if (data.greenMax < 0 || data.yellowMax <= data.greenMax || data.yellowMax > 500) {
    throw new UserError("門檻設定不合理:綠色上限需小於黃色上限");
  }

  await prisma.workloadThreshold.upsert({
    where: { id: "global" },
    create: { id: "global", ...data },
    update: data,
  });
  await logAudit(
    "SETTINGS",
    session.userId,
    `工作量門檻:綠 ≤${data.greenMax}%、黃 ≤${data.yellowMax}%`
  );

  revalidatePath("/dashboard");
}

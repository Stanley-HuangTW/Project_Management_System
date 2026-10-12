import { prisma } from "@/lib/prisma";
import { effectiveHourlyRate } from "@/lib/labourPlan";
import { slotRatesFromSalaries } from "@/lib/labourSheet";
import { getSystemSettings } from "@/lib/actions/systemSettings";

/**
 * 人力表的名額 → 指到的那個人的個人月薪(只有設了月薪的人;見 slotRatesFromSalaries),拿來算人力預算。
 * 薪資是敏感資料,這支只在伺服器端用、結果只用來算金額,不要原樣送到畫面。
 */
export async function loadSlotRates(slots: { id: string; userId: string | null }[]): Promise<Record<string, number>> {
  const userIds = [...new Set(slots.map((s) => s.userId).filter((id): id is string => !!id))];
  if (userIds.length === 0) return {};
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, monthlySalary: true } });
  return slotRatesFromSalaries(slots, Object.fromEntries(users.map((u) => [u.id, u.monthlySalary ? Number(u.monthlySalary) : 0])));
}

/**
 * 每個人算實際成本用的時薪,一張表查完。
 *
 * 三個地方各自建過這張表(預算頁、超支通知、成本彙總),而且都只讀
 * hourlyRate —— 有人只填月薪的話,那三個地方會一致地算出 0 元。改成共用
 * 這一支,月薪與單位標準價那兩條路才會真的生效,而且三邊不會分岔。
 */
export async function effectiveRateMap(): Promise<Map<string, number>> {
  const [users, rates, settings] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, hourlyRate: true, monthlySalary: true, discipline: true },
    }),
    prisma.disciplineRate.findMany(),
    getSystemSettings(),
  ]);
  const byDiscipline = Object.fromEntries(rates.map((r) => [r.discipline, r.monthlySalary]));
  const factors = {
    workingDaysPerMonth: settings.workingDaysPerMonth,
    hoursPerDay: settings.hoursPerDay,
  };

  return new Map(
    users.map((user) => [
      user.id,
      effectiveHourlyRate(
        {
          hourlyRate: user.hourlyRate ? Number(user.hourlyRate) : null,
          monthlySalary: user.monthlySalary ? Number(user.monthlySalary) : null,
          discipline: user.discipline,
        },
        byDiscipline,
        factors
      ),
    ])
  );
}

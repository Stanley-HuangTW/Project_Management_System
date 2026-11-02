import { prisma } from "@/lib/prisma";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { getPersonIds } from "@/types/column";
import { findOverload } from "@/lib/protoUsage";
import { protoUnitLabel } from "@/lib/protoUnits";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { itemLink } from "@/lib/notificationLink";

const MD = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/**
 * 選了樣機、或把佔用百分比調高之後:這幾台樣機有沒有哪幾天被好幾個工作項同時用(合計超過 100%)。
 * 有的話通知「其他」那幾個工作項的負責人(站內通知,Email 照每個人的設定),並回傳一段話給操作的人看。
 * 沒有重疊回 null。通知失敗不影響已經存好的選擇。
 *
 * 只在「增加佔用」的那一刻檢查——拿掉樣機、把百分比調低只會讓重疊變少,不需要提醒。
 */
export async function checkMachineOverload(
  machineIds: string[],
  actor: { userId: string },
  trigger: { itemId: string; itemName: string }
): Promise<string | null> {
  if (machineIds.length === 0) return null;
  const [links, holidayRows] = await Promise.all([
    prisma.itemProtoUnit.findMany({
      where: { protoUnitId: { in: machineIds }, item: { deletedAt: null } },
      select: {
        itemId: true,
        protoUnitId: true,
        usagePct: true,
        item: { select: { id: true, name: true, boardId: true, cellValues: true, assignments: { select: { userId: true } } } },
        protoUnit: { select: { id: true, boardId: true, product: true, unit: true, phaseId: true, seq: true } },
      },
    }),
    listHolidays(),
  ]);
  if (links.length === 0) return null;
  const holidays = toHolidaySet(holidayRows);

  const boardIds = [...new Set(links.map((l) => l.item.boardId))];
  const [boards, phases] = await Promise.all([
    prisma.board.findMany({
      where: { id: { in: boardIds } },
      select: {
        id: true,
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttDurationMode: true,
        columns: { where: { type: "PERSON" }, select: { id: true } },
      },
    }),
    prisma.budgetPhase.findMany({ where: { boardId: { in: boardIds } }, select: { id: true, name: true } }),
  ]);
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));

  const warnings: string[] = [];
  for (const machineId of machineIds) {
    const mine = links.filter((l) => l.protoUnitId === machineId);
    if (mine.length < 2) continue;
    const entries = mine.map((l) => {
      const board = boardById.get(l.item.boardId);
      const range =
        board?.ganttStartColumnId && board.ganttDurationColumnId
          ? getItemDateRange(l.item, board.ganttStartColumnId, board.ganttDurationColumnId, board.ganttDurationMode, holidays)
          : null;
      return { itemId: l.itemId, pct: l.usagePct, start: range?.start ?? null, end: range?.end ?? null, businessDaysOnly: board?.ganttDurationMode === "BUSINESS" };
    });
    const span = findOverload(entries, holidays);
    // 這次動的那個工作項要在重疊的那幾天裡,才跟它有關。
    if (!span || !span.itemIds.includes(trigger.itemId)) continue;

    const label = protoUnitLabel(mine[0].protoUnit, phaseName.get(mine[0].protoUnit.phaseId) ?? "");
    const others = mine.filter((l) => span.itemIds.includes(l.itemId) && l.itemId !== trigger.itemId);
    const names = others.map((l) => `「${l.item.name}」`).join("、");
    const when = span.from === span.to ? MD(span.from) : `${MD(span.from)} ~ ${MD(span.to)}`;
    warnings.push(`${label}:${when} 同時被「${trigger.itemName}」與${names}使用,佔用合計最高 ${span.peak}%(超過 100%)。`);

    try {
      for (const other of others) {
        const board = boardById.get(other.item.boardId);
        const owners = new Set<string>(other.item.assignments.map((a) => a.userId));
        for (const cv of other.item.cellValues) {
          if (board?.columns.some((c) => c.id === cv.columnId)) for (const id of getPersonIds(cv.value)) owners.add(id);
        }
        owners.delete(actor.userId);
        const realUsers = new Set((await prisma.user.findMany({ where: { id: { in: [...owners] } }, select: { id: true } })).map((u) => u.id));
        const recipients = [...owners].filter((id) => realUsers.has(id));
        if (recipients.length === 0) continue;

        const message = `「${trigger.itemName}」也選了${label},${when} 跟「${other.item.name}」同時使用這台樣機(佔用合計最高 ${span.peak}%,超過 100%)`;
        const inApp = new Set(await filterInAppRecipients(prisma, "UPDATED", recipients));
        for (const userId of recipients) {
          if (inApp.has(userId)) {
            await prisma.notification.create({ data: { userId, actorId: actor.userId, type: "UPDATED", itemId: other.itemId, message } });
          }
          await notifyEmailIfNeeded(userId, "UPDATED", message, itemLink(other.item.boardId, other.itemId));
        }
      }
    } catch (err) {
      console.error("proto overload notify failed:", err);
    }
  }
  return warnings.length === 0 ? null : `${warnings.join("\n")}\n\n已通知其他工作項的負責人。要排開的話,改工作項的日期、改用別台樣機,或把佔用百分比調低。`;
}

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { itemLink } from "@/lib/notificationLink";

/**
 * Runs board automation rules whose trigger (STATUS column -> value) matches
 * this change. Writes here go straight through Prisma (not upsertCellValue /
 * moveItemToGroup) so rule-driven changes never re-trigger rule evaluation.
 */
export async function executeAutomationRules(
  boardId: string,
  itemId: string,
  columnId: string,
  newValue: string | number | null,
  actorId: string
) {
  if (typeof newValue !== "string" || !newValue) return;

  const rules = await prisma.automationRule.findMany({
    where: { boardId, triggerColumnId: columnId, triggerValue: newValue, enabled: true },
  });
  if (rules.length === 0) return;

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return;

  for (const rule of rules) {
    if (rule.notifyUserId && rule.notifyUserId !== actorId) {
      const message = `自動化規則「${rule.name}」已觸發:「${item.name}」`;
      const [notifiableId] = await filterInAppRecipients(prisma, "AUTOMATION", [rule.notifyUserId]);
      if (notifiableId) {
        await prisma.notification.create({
          data: {
            userId: rule.notifyUserId,
            actorId,
            type: "AUTOMATION",
            itemId,
            message,
          },
        });
      }
      await notifyEmailIfNeeded(rule.notifyUserId, "AUTOMATION", message, itemLink(boardId, itemId));
    }

    if (rule.setColumnId && rule.setValue !== null) {
      await prisma.cellValue.upsert({
        where: { itemId_columnId: { itemId, columnId: rule.setColumnId } },
        create: { itemId, columnId: rule.setColumnId, value: rule.setValue as Prisma.InputJsonValue },
        update: { value: rule.setValue as Prisma.InputJsonValue },
      });
    }

    if (rule.moveToGroupId && rule.moveToGroupId !== item.groupId) {
      const count = await prisma.item.count({ where: { groupId: rule.moveToGroupId } });
      await prisma.item.update({
        where: { id: itemId },
        data: { groupId: rule.moveToGroupId, order: count },
      });
    }
  }
}

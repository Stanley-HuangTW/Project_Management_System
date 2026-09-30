import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { listHolidays } from "@/lib/holidays";
import { getProgramView } from "@/lib/programView";
import { ProgramView } from "@/components/program/ProgramView";

export default async function ProgramPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const session = await requireSession();

  const [view, holidays, users] = await Promise.all([
    getProgramView(programId, session),
    listHolidays(),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!view) notFound();
  // A group whose boards are ALL closed to this session does not exist as far
  // as this session is concerned — saying "you may not see this" would still
  // confirm it is there. A group that is genuinely empty is a different thing:
  // somebody just made it and has not added boards yet, and telling them that
  // is the whole job.
  if (view.boards.length === 0 && view.hiddenBoardCount > 0) notFound();

  return (
    <ProgramView
      view={view}
      holidays={holidays.map((h) => h.date)}
      users={users}
      currentUserId={session.userId}
      userRole={session.role}
    />
  );
}

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { listConversations } from "@/lib/chatServer";
import { ChatApp } from "@/components/chat/ChatApp";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const session = await requireSession();
  if (session.impersonatorId) {
    return (
      <div className="p-6 text-sm text-neutral-600 dark:text-neutral-300">
        代操作別人的帳號時不能使用對話:發出去的訊息會變成對方說的話,私訊內容也不該讓代操作的人看到。
      </div>
    );
  }

  const { c } = await searchParams;
  const [conversations, users] = await Promise.all([
    listConversations({ userId: session.userId, role: session.role, name: session.name }),
    prisma.user.findMany({ select: { id: true, name: true, avatarUrl: true }, orderBy: { name: "asc" } }),
  ]);

  // key=c:通知點進來換了一間對話(網址的 c 變了)就重新開一個,選到那一間。
  return <ChatApp key={c ?? "none"} initialConversations={conversations} users={users} currentUserId={session.userId} initialKey={c ?? null} />;
}

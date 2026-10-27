import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { Prisma, type ChatKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { accessibleBoardWhere, canAccessBoard } from "@/lib/boardAccess";
import { findMentionedUserIds } from "@/lib/mentions";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { visibleItemIdsForBoards } from "@/lib/serverVisibility";
import { computeWbsCodes } from "@/lib/wbs";
import { normalizeChatLinks, type ChatLinkInput } from "@/lib/chatLinks";
import {
  conversationTitle,
  dmKeyOf,
  isInlineImageName,
  matchSnippet,
  messagePreview,
  normalizeGroupTitle,
  normalizeMessageBody,
  planChatNotifications,
  safeAttachmentName,
  validateAttachments,
  type ChatEventPayload,
} from "@/lib/chat";
import { ChatHub, type ChatActor } from "@/lib/chatHub";
import type {
  ChatBoardRefs,
  ChatConversationDto,
  ChatItemHit,
  ChatMessageDto,
  ChatMessagePage,
  ChatReadState,
  ChatResult,
  ChatSearchHit,
} from "@/lib/chatTypes";

/** 動手的人:id、角色(看板權限要看)、名字(通知要寫)。 */
export type ChatSender = ChatActor & { name: string };

const PAGE_SIZE = 50;
const CATCH_UP_LIMIT = 200;

/** boardAccess 的函式吃整個 session;對話只用到 id 與角色,其餘欄位用不到。 */
function asSession(actor: ChatActor, name = ""): SessionPayload {
  return { userId: actor.userId, role: actor.role, email: "", name };
}

// ── 即時推送 ────────────────────────────────────────────────

const globalForHub = globalThis as unknown as { chatHub?: ChatHub };

/** 每個 worker 行程一個。放在 globalThis:開發模式熱更新與 route / action 各自打包時才不會變成好幾個。 */
export function getChatHub(): ChatHub {
  if (!globalForHub.chatHub) {
    globalForHub.chatHub = new ChatHub({
      latestId: async () => (await prisma.chatEvent.aggregate({ _max: { id: true } }))._max.id ?? 0,
      fetchSince: (afterId, limit) =>
        prisma.chatEvent.findMany({ where: { id: { gt: afterId } }, orderBy: { id: "asc" }, take: limit }),
      canAccess: (actor, kind, id) => (kind === "item" ? canAccessItem(actor, id) : canAccessConversationId(actor, id)),
      purge: async () => {
        await prisma.chatEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } });
      },
    });
  }
  return globalForHub.chatHub;
}

export async function publishChatEvent(event: ChatEventPayload): Promise<void> {
  await prisma.chatEvent.create({
    data: { type: event.type, conversationId: event.c, userId: event.u, messageId: event.m },
  });
  getChatHub().wake();
}

// ── 權限 ────────────────────────────────────────────────────

type ConvRef = { id: string; kind: ChatKind; boardId: string | null };

/** 私訊與群組:是成員才進得來。看板頻道:看得到那個看板就進得來(跟看板本身的權限一致,看板進了垃圾桶就關起來)。 */
async function canAccessConversation(actor: ChatActor, conv: ConvRef): Promise<boolean> {
  if (conv.kind === "BOARD") return conv.boardId ? canAccessBoard(asSession(actor), conv.boardId) : false;
  const member = await prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId: conv.id, userId: actor.userId } },
    select: { userId: true },
  });
  return !!member;
}

export async function canAccessConversationId(actor: ChatActor, conversationId: string): Promise<boolean> {
  const conv = await prisma.chatConversation.findUnique({ where: { id: conversationId }, select: { id: true, kind: true, boardId: true } });
  return conv ? canAccessConversation(actor, conv) : false;
}

/** 工作項留言的即時更新:看得到那個工作項所在的看板才收得到(事件只帶工作項 id,內容由瀏覽器再讀)。 */
async function canAccessItem(actor: ChatActor, itemId: string): Promise<boolean> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  return item ? canAccessBoard(asSession(actor), item.boardId) : false;
}

const NOT_FOUND = "找不到這個對話,或者你沒有權限";

async function accessibleConversation(actor: ChatActor, conversationId: string) {
  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, kind: true, boardId: true, title: true, board: { select: { name: true } } },
  });
  if (!conv || !(await canAccessConversation(actor, conv))) return null;
  return conv;
}

// ── 清單 ────────────────────────────────────────────────────

async function unreadCounts(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ conversationId: string; n: number }[]>(Prisma.sql`
    select m."conversationId" as "conversationId", count(*)::int as n
    from "ChatMessage" m
    join "ChatMember" cm on cm."conversationId" = m."conversationId" and cm."userId" = ${userId}
    where m."createdAt" > cm."lastReadAt" and m."authorId" <> ${userId} and m."deletedAt" is null
    group by m."conversationId"`);
  return new Map(rows.map((r) => [r.conversationId, r.n]));
}

export async function getUnreadTotal(actor: ChatActor): Promise<number> {
  let total = 0;
  for (const n of (await unreadCounts(actor.userId)).values()) total += n;
  return total;
}

type LastMessageRow = { conversationId: string; authorId: string; body: string; deletedAt: Date | null; createdAt: Date; hasFiles: boolean };

async function lastMessages(conversationIds: string[]): Promise<Map<string, LastMessageRow>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<LastMessageRow[]>(Prisma.sql`
    select distinct on (m."conversationId") m."conversationId", m."authorId", m."body", m."deletedAt", m."createdAt",
      exists (select 1 from "ChatAttachment" a where a."messageId" = m."id") as "hasFiles"
    from "ChatMessage" m
    where m."conversationId" = any(${conversationIds}::text[])
    order by m."conversationId", m."createdAt" desc`);
  return new Map(rows.map((r) => [r.conversationId, r]));
}

/**
 * 這個人的對話清單:他看得到的每個看板一間頻道(還沒人開過的也列出來)、他在裡面的群組、
 * 他的私訊(對方還沒回過、自己也沒發過的空私訊不列)。排序交給畫面。
 */
export async function listConversations(actor: ChatSender): Promise<ChatConversationDto[]> {
  const me = actor.userId;
  const [boards, convs, unread] = await Promise.all([
    prisma.board.findMany({
      where: accessibleBoardWhere(asSession(actor)),
      select: { id: true, name: true, chatConversation: { select: { id: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.chatConversation.findMany({
      where: {
        kind: { in: ["DM", "GROUP"] },
        members: { some: { userId: me } },
        OR: [{ kind: "GROUP" }, { createdById: me }, { messages: { some: {} } }],
      },
      select: {
        id: true,
        kind: true,
        title: true,
        members: { select: { userId: true, user: { select: { name: true, avatarUrl: true } } } },
      },
    }),
    unreadCounts(me),
  ]);

  const ids = [...convs.map((c) => c.id), ...boards.flatMap((b) => (b.chatConversation ? [b.chatConversation.id] : []))];
  const last = await lastMessages(ids);
  const authorIds = [...new Set([...last.values()].map((m) => m.authorId).filter((id) => id !== me))];
  const authors = authorIds.length ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const authorName = new Map(authors.map((a) => [a.id, a.name]));

  const lastOf = (id: string | null) => {
    const m = id ? last.get(id) : undefined;
    if (!m) return { at: null, preview: null };
    const who = m.authorId === me ? "你" : (authorName.get(m.authorId) ?? "");
    const text = m.deletedAt ? "訊息已收回" : messagePreview(m.body, m.hasFiles, 40);
    return { at: m.createdAt.toISOString(), preview: who ? `${who}:${text}` : text };
  };

  const fromBoards: ChatConversationDto[] = boards.map((b) => {
    const id = b.chatConversation?.id ?? null;
    const l = lastOf(id);
    return {
      key: id ?? `board:${b.id}`,
      id,
      kind: "BOARD",
      boardId: b.id,
      title: conversationTitle({ kind: "BOARD", title: null, boardName: b.name, otherName: null }),
      otherUserId: null,
      otherAvatarUrl: null,
      memberIds: [],
      unread: id ? (unread.get(id) ?? 0) : 0,
      lastMessageAt: l.at,
      lastPreview: l.preview,
    };
  });

  const fromConvs: ChatConversationDto[] = convs.map((c) => {
    const other = c.kind === "DM" ? c.members.find((m) => m.userId !== me) : undefined;
    const l = lastOf(c.id);
    return {
      key: c.id,
      id: c.id,
      kind: c.kind,
      boardId: null,
      title: conversationTitle({ kind: c.kind, title: c.title, boardName: null, otherName: other?.user.name ?? null }),
      otherUserId: other?.userId ?? null,
      otherAvatarUrl: other?.user.avatarUrl ?? null,
      memberIds: c.kind === "GROUP" ? c.members.map((m) => m.userId) : [],
      unread: unread.get(c.id) ?? 0,
      lastMessageAt: l.at,
      lastPreview: l.preview,
    };
  });

  return [...fromBoards, ...fromConvs];
}

// ── 讀訊息 ──────────────────────────────────────────────────

type MessageRow = {
  id: string;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  author: { name: string; avatarUrl: string | null };
  attachments: { id: string; fileName: string; size: number; isLink: boolean; url: string }[];
};

const messageInclude = {
  author: { select: { name: true, avatarUrl: true } },
  attachments: { select: { id: true, fileName: true, size: true, isLink: true, url: true }, orderBy: { createdAt: "asc" } },
} as const;

function toMessageDto(row: MessageRow): ChatMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    authorName: row.author.name,
    authorAvatarUrl: row.author.avatarUrl,
    body: row.deletedAt ? "" : row.body,
    deleted: row.deletedAt !== null,
    attachments: row.deletedAt
      ? []
      : row.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          size: a.size,
          isImage: !a.isLink && isInlineImageName(a.fileName),
          link: a.isLink ? a.url : null,
        })),
    createdAt: row.createdAt.toISOString(),
  };
}

async function readStatesOf(conv: ConvRef): Promise<ChatReadState[]> {
  // 看板頻道人多,不追蹤誰讀到哪。
  if (conv.kind === "BOARD") return [];
  const members = await prisma.chatMember.findMany({ where: { conversationId: conv.id }, select: { userId: true, lastReadAt: true } });
  return members.map((m) => ({ userId: m.userId, lastReadAt: m.lastReadAt.toISOString() }));
}

/**
 * 一頁訊息,舊的在前。沒給游標 = 最新的一頁;beforeId = 比那一則更早的一頁(往上捲);
 * afterId = 比那一則更晚的全部(斷線重連、或收到推送後補資料用)。
 */
export async function loadMessages(
  actor: ChatActor,
  conversationId: string,
  cursor: { beforeId?: string; afterId?: string } = {}
): Promise<ChatResult<ChatMessagePage>> {
  const conv = await accessibleConversation(actor, conversationId);
  if (!conv) return { error: NOT_FOUND };

  const anchorId = cursor.afterId ?? cursor.beforeId;
  const anchor = anchorId
    ? await prisma.chatMessage.findFirst({ where: { id: anchorId, conversationId }, select: { createdAt: true } })
    : null;

  let rows: MessageRow[];
  let hasMore = false;
  if (cursor.afterId && anchor) {
    rows = await prisma.chatMessage.findMany({
      where: { conversationId, createdAt: { gt: anchor.createdAt } },
      orderBy: { createdAt: "asc" },
      take: CATCH_UP_LIMIT,
      include: messageInclude,
    });
  } else {
    const older = await prisma.chatMessage.findMany({
      where: { conversationId, ...(cursor.beforeId && anchor ? { createdAt: { lt: anchor.createdAt } } : {}) },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE + 1,
      include: messageInclude,
    });
    hasMore = older.length > PAGE_SIZE;
    rows = older.slice(0, PAGE_SIZE).reverse();
  }
  return { messages: rows.map(toMessageDto), hasMore, readStates: await readStatesOf(conv) };
}

// ── 開對話 ──────────────────────────────────────────────────

/**
 * 看板的擁有者、成員、分組角色與分組成員,自動算「在頻道裡」(有已讀位置,有新訊息會亮未讀)。
 * 公開看板的其他人要自己打開過才加入。已經在的不動,新加的從「現在」開始算已讀。
 */
async function ensureBoardChannelMembers(conversationId: string, boardId: string): Promise<void> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      ownerId: true,
      members: { select: { userId: true } },
      groups: { select: { roleAssignments: { select: { userId: true } }, members: { select: { userId: true } } } },
    },
  });
  if (!board) return;
  const userIds = new Set<string>([board.ownerId]);
  for (const m of board.members) userIds.add(m.userId);
  for (const g of board.groups) {
    for (const r of g.roleAssignments) userIds.add(r.userId);
    for (const m of g.members) userIds.add(m.userId);
  }
  await prisma.chatMember.createMany({ data: [...userIds].map((userId) => ({ conversationId, userId })), skipDuplicates: true });
}

export async function openBoardChannel(actor: ChatSender, boardId: string): Promise<ChatResult<{ conversationId: string }>> {
  if (!(await canAccessBoard(asSession(actor, actor.name), boardId))) return { error: "你沒有這個看板的存取權限" };
  const conv = await prisma.chatConversation.upsert({
    where: { boardId },
    create: { kind: "BOARD", boardId },
    update: {},
    select: { id: true },
  });
  await ensureBoardChannelMembers(conv.id, boardId);
  return { conversationId: conv.id };
}

export async function openDirectConversation(actor: ChatSender, otherUserId: string): Promise<ChatResult<{ conversationId: string }>> {
  if (otherUserId === actor.userId) return { error: "不能傳訊息給自己" };
  const other = await prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
  if (!other) return { error: "找不到這個使用者" };
  const dmKey = dmKeyOf(actor.userId, otherUserId);
  const conv = await prisma.chatConversation.upsert({
    where: { dmKey },
    create: { kind: "DM", dmKey, createdById: actor.userId },
    update: {},
    select: { id: true },
  });
  await prisma.chatMember.createMany({
    data: [actor.userId, otherUserId].map((userId) => ({ conversationId: conv.id, userId })),
    skipDuplicates: true,
  });
  return { conversationId: conv.id };
}

/** 挑出真的有帳號的人(Resource 沒有帳號,聊不了),去掉重複。 */
async function realUserIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function createGroup(actor: ChatSender, rawTitle: string, memberIds: string[]): Promise<ChatResult<{ conversationId: string }>> {
  const t = normalizeGroupTitle(rawTitle);
  if ("error" in t) return { error: t.error };
  const others = (await realUserIds(memberIds)).filter((id) => id !== actor.userId);
  if (others.length === 0) return { error: "請至少選一位成員" };
  const conv = await prisma.chatConversation.create({
    data: {
      kind: "GROUP",
      title: t.title,
      createdById: actor.userId,
      members: { create: [actor.userId, ...others].map((userId) => ({ userId })) },
    },
    select: { id: true },
  });
  for (const userId of others) await publishChatEvent({ type: "conversation", c: conv.id, u: userId, m: null });
  return { conversationId: conv.id };
}

async function groupOf(actor: ChatActor, conversationId: string) {
  const conv = await accessibleConversation(actor, conversationId);
  return conv && conv.kind === "GROUP" ? conv : null;
}

export async function addGroupMembers(actor: ChatActor, conversationId: string, userIds: string[]): Promise<ChatResult<{ added: number }>> {
  if (!(await groupOf(actor, conversationId))) return { error: NOT_FOUND };
  const existing = new Set((await prisma.chatMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId));
  const added = (await realUserIds(userIds)).filter((id) => !existing.has(id));
  if (added.length === 0) return { added: 0 };
  await prisma.chatMember.createMany({ data: added.map((userId) => ({ conversationId, userId })), skipDuplicates: true });
  for (const userId of added) await publishChatEvent({ type: "conversation", c: conversationId, u: userId, m: null });
  return { added: added.length };
}

export async function renameGroup(actor: ChatActor, conversationId: string, rawTitle: string): Promise<ChatResult<{ title: string }>> {
  if (!(await groupOf(actor, conversationId))) return { error: NOT_FOUND };
  const t = normalizeGroupTitle(rawTitle);
  if ("error" in t) return { error: t.error };
  await prisma.chatConversation.update({ where: { id: conversationId }, data: { title: t.title } });
  return { title: t.title };
}

/** 離開群組;最後一個人離開,群組連同訊息一起消失。 */
export async function leaveGroup(actor: ChatActor, conversationId: string): Promise<ChatResult<{ ok: true }>> {
  if (!(await groupOf(actor, conversationId))) return { error: NOT_FOUND };
  await prisma.chatMember.delete({ where: { conversationId_userId: { conversationId, userId: actor.userId } } });
  const left = await prisma.chatMember.count({ where: { conversationId } });
  if (left === 0) {
    const files = await prisma.chatAttachment.findMany({ where: { message: { conversationId }, isLink: false }, select: { url: true } });
    await prisma.chatConversation.delete({ where: { id: conversationId } });
    await unlinkQuietly(files.map((f) => f.url));
  }
  return { ok: true };
}

// ── 發訊息、已讀、收回 ──────────────────────────────────────

/** 瀏覽器傳上來的一個檔案。 */
export type ChatUpload = { name: string; bytes: Buffer };

const UPLOAD_ROOT = () => path.join(process.cwd(), "public", "uploads", "chat");

async function unlinkQuietly(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await unlink(path.join(process.cwd(), "public", url));
    } catch {
      // 檔案本來就不在了;資料庫那邊刪掉才是重點。
    }
  }
}

export async function sendMessage(
  actor: ChatSender,
  conversationId: string,
  rawBody: string,
  files: ChatUpload[] = [],
  rawLinks: ChatLinkInput[] = []
): Promise<ChatResult<{ message: ChatMessageDto }>> {
  const linkResult = normalizeChatLinks(rawLinks);
  if ("error" in linkResult) return { error: linkResult.error };
  const links = linkResult.links;
  const norm = normalizeMessageBody(rawBody, files.length > 0 || links.length > 0);
  if ("error" in norm) return { error: norm.error };
  const fileError = validateAttachments(files.map((f) => ({ name: f.name, size: f.bytes.length })));
  if (fileError) return { error: fileError };
  const conv = await accessibleConversation(actor, conversationId);
  if (!conv) return { error: NOT_FOUND };

  // 先把該在頻道裡的人補進名單,再寫訊息:新補進來的人已讀位置是「現在」,
  // 比這則訊息早,所以這則會算他的未讀。
  if (conv.kind === "BOARD" && conv.boardId) await ensureBoardChannelMembers(conv.id, conv.boardId);

  // 檔案先寫到磁碟,訊息與檔案紀錄一起建;建失敗就把剛寫的檔案收掉,不留孤兒。
  const stored: { fileName: string; url: string; size: number }[] = [];
  if (files.length > 0) {
    const dir = path.join(UPLOAD_ROOT(), conversationId);
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      const storedName = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeAttachmentName(file.name)}`;
      await writeFile(path.join(dir, storedName), file.bytes);
      stored.push({ fileName: file.name, url: `/uploads/chat/${conversationId}/${storedName}`, size: file.bytes.length });
    }
  }
  let row;
  try {
    row = await prisma.chatMessage.create({
      data: {
        conversationId,
        authorId: actor.userId,
        body: norm.body,
        // 連結跟檔案放在同一張表:連結沒有東西在磁碟上,url 是網址或本系統的位置。
        attachments: { create: [...stored, ...links.map((l) => ({ fileName: l.label, url: l.url, size: 0, isLink: true }))] },
      },
      include: messageInclude,
    });
  } catch (err) {
    await unlinkQuietly(stored.map((a) => a.url));
    throw err;
  }
  await prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: row.createdAt } });
  // 自己發的,當然讀到這裡了。
  await prisma.chatMember.upsert({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
    create: { conversationId, userId: actor.userId, lastReadAt: row.createdAt },
    update: { lastReadAt: row.createdAt },
  });
  await publishChatEvent({ type: "message", c: conversationId, u: actor.userId, m: row.id });
  await notifyNewMessage(actor, conv, norm.body, files.length > 0 || links.length > 0);
  return { message: toMessageDto(row) };
}

async function notifyNewMessage(
  actor: ChatSender,
  conv: { id: string; kind: ChatKind; boardId: string | null; title: string | null; board: { name: string } | null },
  body: string,
  hasFiles: boolean
): Promise<void> {
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } });
  const mentioned = findMentionedUserIds(body, users).filter((id) => id !== actor.userId);

  let memberIds: string[] = [];
  if (conv.kind !== "BOARD") {
    memberIds = (await prisma.chatMember.findMany({ where: { conversationId: conv.id }, select: { userId: true } })).map((m) => m.userId);
  }
  // 看不到這間對話的人,@ 了也不通知——通知點下去進不來。
  const roleOf = new Map(users.map((u) => [u.id, u.role]));
  const mentionedAllowed: string[] = [];
  for (const id of mentioned) {
    const ok =
      conv.kind === "BOARD"
        ? !!conv.boardId && (await canAccessBoard(asSession({ userId: id, role: roleOf.get(id) ?? "MEMBER" }), conv.boardId))
        : memberIds.includes(id);
    if (ok) mentionedAllowed.push(id);
  }

  const alreadyUnread =
    memberIds.length > 0
      ? new Set(
          (
            await prisma.notification.findMany({
              where: { conversationId: conv.id, type: "CHAT", read: false, userId: { in: memberIds } },
              select: { userId: true },
            })
          ).map((n) => n.userId)
        )
      : new Set<string>();

  const plan = planChatNotifications({
    kind: conv.kind,
    conversationName: conv.kind === "BOARD" ? (conv.board?.name ?? "看板") : (conv.title ?? "聊天室"),
    actorId: actor.userId,
    actorName: actor.name,
    memberIds,
    mentionedIds: mentionedAllowed,
    alreadyUnread,
  });
  if (plan.length === 0) return;

  const inApp = new Set(await filterInAppRecipients(prisma, "CHAT", plan.map((n) => n.userId)));
  const rows = plan.filter((n) => inApp.has(n.userId));
  if (rows.length > 0) {
    await prisma.notification.createMany({
      data: rows.map((n) => ({ userId: n.userId, actorId: actor.userId, type: "CHAT" as const, conversationId: conv.id, message: n.message })),
    });
  }
  // 寄信要連外,不讓它拖慢訊息送出;寄不出去也不影響訊息。
  void (async () => {
    for (const n of plan) {
      try {
        await notifyEmailIfNeeded(n.userId, "CHAT", `${n.message}\n\n${messagePreview(body, hasFiles, 120)}`);
      } catch (err) {
        console.error("chat email failed:", err);
      }
    }
  })();
}

/** 把這間對話標成讀到最新;已經是最新就不再通知別人。 */
export async function markConversationRead(actor: ChatActor, conversationId: string): Promise<ChatResult<{ ok: true }>> {
  const conv = await accessibleConversation(actor, conversationId);
  if (!conv) return { error: NOT_FOUND };
  const latest = await prisma.chatMessage.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const at = latest?.createdAt ?? new Date();
  const member = await prisma.chatMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
    select: { lastReadAt: true },
  });
  if (!member || member.lastReadAt < at) {
    await prisma.chatMember.upsert({
      where: { conversationId_userId: { conversationId, userId: actor.userId } },
      create: { conversationId, userId: actor.userId, lastReadAt: at },
      update: { lastReadAt: at },
    });
    if (member && conv.kind !== "BOARD") await publishChatEvent({ type: "read", c: conversationId, u: actor.userId, m: null });
  }
  await prisma.notification.updateMany({ where: { userId: actor.userId, conversationId, read: false }, data: { read: true } });
  return { ok: true };
}

/** 收回自己的訊息:訊息還留著,只是不再顯示內容。 */
export async function deleteMessage(actor: ChatActor, messageId: string): Promise<ChatResult<{ ok: true }>> {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, authorId: true, conversationId: true, deletedAt: true } });
  if (!message || !(await accessibleConversation(actor, message.conversationId))) return { error: "找不到這則訊息" };
  if (message.authorId !== actor.userId) return { error: "只能收回自己的訊息" };
  if (message.deletedAt) return { ok: true };
  const files = await prisma.chatAttachment.findMany({ where: { messageId, isLink: false }, select: { url: true } });
  await prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
  // 收回就是大家都看不到了:檔案也一起刪,不能只藏起訊息、檔案還躺在磁碟上。
  await prisma.chatAttachment.deleteMany({ where: { messageId } });
  await unlinkQuietly(files.map((f) => f.url));
  await publishChatEvent({ type: "deleted", c: message.conversationId, u: actor.userId, m: messageId });
  return { ok: true };
}

// ── 搜尋 ────────────────────────────────────────────────────

const SEARCH_LIMIT = 30;

/**
 * 在這個人看得到的對話裡搜訊息內容:他在的私訊與群組,加上他看得到的看板的頻道。
 * 從「他能進的對話」出發再查,不是查完再過濾——查到再擋,結果數量與排序就已經洩漏了別人的對話。
 * 收回的訊息不搜。
 */
export async function searchMessages(actor: ChatSender, rawQuery: string): Promise<ChatSearchHit[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];
  const me = actor.userId;
  const [boards, mine] = await Promise.all([
    prisma.board.findMany({
      where: { ...accessibleBoardWhere(asSession(actor)), chatConversation: { isNot: null } },
      select: { name: true, chatConversation: { select: { id: true } } },
    }),
    prisma.chatConversation.findMany({
      where: { kind: { in: ["DM", "GROUP"] }, members: { some: { userId: me } } },
      select: { id: true, kind: true, title: true, members: { select: { userId: true, user: { select: { name: true } } } } },
    }),
  ]);
  const titles = new Map<string, { title: string; kind: "BOARD" | "DM" | "GROUP" }>();
  for (const b of boards) if (b.chatConversation) titles.set(b.chatConversation.id, { title: b.name, kind: "BOARD" });
  for (const c of mine) {
    const other = c.kind === "DM" ? c.members.find((m) => m.userId !== me) : undefined;
    titles.set(c.id, {
      title: conversationTitle({ kind: c.kind, title: c.title, boardName: null, otherName: other?.user.name ?? null }),
      kind: c.kind as "DM" | "GROUP",
    });
  }
  if (titles.size === 0) return [];

  const rows = await prisma.chatMessage.findMany({
    where: { conversationId: { in: [...titles.keys()] }, deletedAt: null, body: { contains: query, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: SEARCH_LIMIT,
    select: { id: true, conversationId: true, body: true, createdAt: true, author: { select: { name: true } } },
  });
  return rows.map((r) => {
    const t = titles.get(r.conversationId)!;
    return {
      messageId: r.id,
      conversationKey: r.conversationId,
      conversationTitle: t.title,
      kind: t.kind,
      authorName: r.author.name,
      createdAt: r.createdAt.toISOString(),
      excerpt: matchSnippet(r.body, query),
    };
  });
}

/**
 * 把訊息轉成待辦事項或留言時挑項目:所有看得到的看板上、名稱含關鍵字的工作項。
 * 跟全站搜尋一樣,私人項目與私人分組也要擋(看板進得去,不代表裡面每一列都看得到)。
 */
export async function searchItemsForChat(actor: ChatSender, rawQuery: string): Promise<ChatItemHit[]> {
  const query = rawQuery.trim();
  if (query.length < 1) return [];
  const boards = await prisma.board.findMany({ where: accessibleBoardWhere(asSession(actor)), select: { id: true, name: true } });
  if (boards.length === 0) return [];
  const visible = await visibleItemIdsForBoards(boards.map((b) => b.id), asSession(actor));
  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  const items = await prisma.item.findMany({
    where: { boardId: { in: boards.map((b) => b.id) }, deletedAt: null, name: { contains: query, mode: "insensitive" } },
    select: { id: true, name: true, boardId: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  return items
    .filter((i) => visible.has(i.id))
    .slice(0, 20)
    .map((i) => ({ itemId: i.id, boardId: i.boardId, name: i.name, boardName: boardName.get(i.boardId) ?? "" }));
}

/** 這個人看得到的看板(挑項目、引用時,不是看板頻道的對話要先選看板)。 */
export async function listBoardsForChat(actor: ChatSender): Promise<{ id: string; name: string }[]> {
  return prisma.board.findMany({
    where: accessibleBoardWhere(asSession(actor)),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * 一個看板的工作項、風險、問題清單,給「挑一個來引用 / 加待辦 / 加留言」用。
 * 看板要進得去;私人工作項與私人分組照樣擋(跟搜尋同一套);風險與問題跟風險登記冊一樣,看得到看板就看得到。
 */
export async function listBoardRefsForChat(actor: ChatSender, boardId: string): Promise<ChatBoardRefs | null> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, AND: [accessibleBoardWhere(asSession(actor))] },
    select: { id: true, name: true },
  });
  if (!board) return null;
  const [visible, rows, groups, risks] = await Promise.all([
    visibleItemIdsForBoards([boardId], asSession(actor)),
    prisma.item.findMany({
      where: { boardId, deletedAt: null },
      select: { id: true, name: true, parentId: true, order: true, groupId: true },
    }),
    prisma.group.findMany({ where: { boardId }, select: { id: true, name: true, order: true }, orderBy: { order: "asc" } }),
    prisma.riskEntry.findMany({
      where: { boardId },
      select: { id: true, title: true, kind: true, status: true, mantisId: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  // WBS 代號是每個分組各自從 1 開始算的。
  const items = groups.flatMap((group) => {
    const inGroup = rows.filter((r) => r.groupId === group.id);
    const codes = computeWbsCodes(inGroup);
    return inGroup
      .filter((r) => visible.has(r.id))
      .map((r) => ({ id: r.id, name: r.name, wbsCode: codes.get(r.id) ?? "", groupName: group.name }));
  });
  return { boardId: board.id, boardName: board.name, items, risks };
}

// ── 附件下載 ────────────────────────────────────────────────

/** 這個人看不看得到這個附件(看得到它所在的那間對話,而且訊息沒被收回)。給 /api/chat/attachments 用。 */
export async function findAccessibleAttachment(actor: ChatActor, attachmentId: string): Promise<{ fileName: string; url: string } | null> {
  const attachment = await prisma.chatAttachment.findUnique({
    where: { id: attachmentId },
    select: { fileName: true, url: true, isLink: true, message: { select: { conversationId: true, deletedAt: true } } },
  });
  // 連結不是檔案,沒有東西可以下載(也不能讓這支 API 把任意網址當成檔案路徑吐出去)。
  if (!attachment || attachment.isLink || attachment.message.deletedAt) return null;
  if (!(await canAccessConversationId(actor, attachment.message.conversationId))) return null;
  return { fileName: attachment.fileName, url: attachment.url };
}

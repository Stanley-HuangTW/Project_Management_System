"use server";

import { requireSession } from "@/lib/session";
import * as chat from "@/lib/chatServer";
import type { ChatSender } from "@/lib/chatServer";
import type { ChatConversationDto, ChatItemHit, ChatMessageDto, ChatMessagePage, ChatResult, ChatSearchHit } from "@/lib/chatTypes";

/**
 * 管理者「代操作」別人的帳號時不能用對話:發出去的訊息會變成那個人說的話,
 * 私訊內容也不該讓代操作的人看到。
 */
async function sender(): Promise<ChatSender | { error: string }> {
  const session = await requireSession();
  if (session.impersonatorId) return { error: "代操作時不能使用對話功能" };
  return { userId: session.userId, role: session.role, name: session.name };
}

export async function listMyConversations(): Promise<ChatConversationDto[]> {
  const me = await sender();
  return "error" in me ? [] : chat.listConversations(me);
}

export async function getChatUnread(): Promise<number> {
  const me = await sender();
  return "error" in me ? 0 : chat.getUnreadTotal(me);
}

export async function loadChatMessages(
  conversationId: string,
  cursor: { beforeId?: string; afterId?: string } = {}
): Promise<ChatResult<ChatMessagePage>> {
  const me = await sender();
  return "error" in me ? me : chat.loadMessages(me, conversationId, cursor);
}

/** formData:`body` 是文字,`file` 是零到多個檔案(同名欄位重複)。 */
export async function sendChatMessage(conversationId: string, formData: FormData): Promise<ChatResult<{ message: ChatMessageDto }>> {
  const me = await sender();
  if ("error" in me) return me;
  const body = formData.get("body");
  const files: chat.ChatUpload[] = [];
  for (const entry of formData.getAll("file")) {
    if (entry instanceof File && entry.name) files.push({ name: entry.name, bytes: Buffer.from(await entry.arrayBuffer()) });
  }
  return chat.sendMessage(me, conversationId, typeof body === "string" ? body : "", files);
}

export async function searchChatMessages(query: string): Promise<ChatSearchHit[]> {
  const me = await sender();
  return "error" in me ? [] : chat.searchMessages(me, query);
}

export async function searchChatItems(query: string): Promise<ChatItemHit[]> {
  const me = await sender();
  return "error" in me ? [] : chat.searchItemsForChat(me, query);
}

export async function markChatRead(conversationId: string): Promise<ChatResult<{ ok: true }>> {
  const me = await sender();
  return "error" in me ? me : chat.markConversationRead(me, conversationId);
}

export async function deleteChatMessage(messageId: string): Promise<ChatResult<{ ok: true }>> {
  const me = await sender();
  return "error" in me ? me : chat.deleteMessage(me, messageId);
}

export async function openBoardChat(boardId: string): Promise<ChatResult<{ conversationId: string }>> {
  const me = await sender();
  return "error" in me ? me : chat.openBoardChannel(me, boardId);
}

export async function openDirectChat(userId: string): Promise<ChatResult<{ conversationId: string }>> {
  const me = await sender();
  return "error" in me ? me : chat.openDirectConversation(me, userId);
}

export async function createChatGroup(title: string, memberIds: string[]): Promise<ChatResult<{ conversationId: string }>> {
  const me = await sender();
  return "error" in me ? me : chat.createGroup(me, title, memberIds);
}

export async function addChatGroupMembers(conversationId: string, userIds: string[]): Promise<ChatResult<{ added: number }>> {
  const me = await sender();
  return "error" in me ? me : chat.addGroupMembers(me, conversationId, userIds);
}

export async function renameChatGroup(conversationId: string, title: string): Promise<ChatResult<{ title: string }>> {
  const me = await sender();
  return "error" in me ? me : chat.renameGroup(me, conversationId, title);
}

export async function leaveChatGroup(conversationId: string): Promise<ChatResult<{ ok: true }>> {
  const me = await sender();
  return "error" in me ? me : chat.leaveGroup(me, conversationId);
}

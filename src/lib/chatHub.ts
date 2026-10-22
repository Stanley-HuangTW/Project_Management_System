import type { ChatEventPayload, ChatEventType } from "@/lib/chat";

export type ChatEventRow = {
  id: number;
  type: string;
  conversationId: string;
  userId: string | null;
  messageId: string | null;
};

export type ChatActor = { userId: string; role: "ADMIN" | "SUPERVISOR" | "MEMBER" };

export type HubDeps = {
  /** 資料庫裡目前最大的事件 id(沒有就 0)。 */
  latestId: () => Promise<number>;
  /** id 大於 afterId 的事件,舊的在前。 */
  fetchSince: (afterId: number, limit: number) => Promise<ChatEventRow[]>;
  /** 這個人現在看不看得到這間對話(kind=conversation)或這個工作項(kind=item,工作項留言的即時更新用)。 */
  canAccess: (actor: ChatActor, kind: "conversation" | "item", id: string) => Promise<boolean>;
  /** 清掉太舊的事件。 */
  purge: () => Promise<void>;
};

export type HubOptions = {
  pollMs?: number;
  /** 「看不看得到」查到的結果記多久。事件只帶「哪裡有變」、不帶內容,晚幾十秒才發現被移出群組,不會洩漏訊息。 */
  accessTtlMs?: number;
  purgeEveryMs?: number;
  now?: () => number;
  onError?: (err: unknown) => void;
};

type Sub = ChatActor & { send: (payload: ChatEventPayload) => void; access: Map<string, { ok: boolean; at: number }> };

const BATCH = 200;

/**
 * server.js 是多行程(cluster):一個行程收到的訊息,要讓別的行程手上的連線也收得到。
 * 做法是所有行程都盯著同一張事件表(ChatEvent),每個行程定時讀新的列、推給自己手上
 * 有權限的連線——不用另外裝訊息中介軟體,而且單一行程的開發模式行為完全一樣。
 * 沒有人連線時不查資料庫;有人連線時每 pollMs 查一次,有新事件才多做事。
 */
export class ChatHub {
  private subs = new Set<Sub>();
  private lastId: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private again = false;
  private lastPurgeAt = 0;
  private readonly pollMs: number;
  private readonly accessTtlMs: number;
  private readonly purgeEveryMs: number;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;

  constructor(
    private deps: HubDeps,
    options: HubOptions = {}
  ) {
    this.pollMs = options.pollMs ?? 500;
    this.accessTtlMs = options.accessTtlMs ?? 30_000;
    this.purgeEveryMs = options.purgeEveryMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? ((err) => console.error("chat hub poll failed:", err));
  }

  /** 登記一條連線,回傳取消登記的函式。第一條連線進來時才開始輪詢。 */
  async subscribe(actor: ChatActor, send: (payload: ChatEventPayload) => void): Promise<() => void> {
    // 從「現在」開始推:連線之前的事件不補發,瀏覽器連上之後會自己重讀。
    if (this.lastId === null) this.lastId = await this.deps.latestId();
    const sub: Sub = { ...actor, send, access: new Map() };
    this.subs.add(sub);
    if (!this.timer) {
      this.timer = setInterval(() => void this.poll(), this.pollMs);
      this.timer.unref?.();
    }
    return () => {
      this.subs.delete(sub);
      if (this.subs.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        // 沒人在聽的時候事件照樣會進表,下次有人連線再從「那時候」開始,不用回頭讀。
        this.lastId = null;
      }
    };
  }

  get connections(): number {
    return this.subs.size;
  }

  /** 馬上查一次(同一個行程發的訊息不必等下一輪)。 */
  wake(): void {
    if (this.timer) void this.poll();
  }

  async poll(): Promise<void> {
    if (this.polling) {
      this.again = true;
      return;
    }
    this.polling = true;
    try {
      do {
        this.again = false;
        if (this.lastId === null) break;
        let rows: ChatEventRow[];
        do {
          rows = await this.deps.fetchSince(this.lastId, BATCH);
          for (const row of rows) {
            this.lastId = row.id;
            await this.deliver(row);
          }
        } while (rows.length === BATCH && this.lastId !== null);
      } while (this.again);

      if (this.now() - this.lastPurgeAt > this.purgeEveryMs) {
        this.lastPurgeAt = this.now();
        await this.deps.purge();
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.polling = false;
    }
  }

  private async deliver(row: ChatEventRow): Promise<void> {
    const payload: ChatEventPayload = {
      type: row.type as ChatEventType,
      c: row.conversationId,
      u: row.userId,
      m: row.messageId,
    };
    await Promise.all(
      [...this.subs].map(async (sub) => {
        // 對話清單有變(被加進群組):只通知被加的那個人,他自己再去讀有權限檢查的清單。
        if (row.type === "conversation") {
          if (sub.userId === row.userId) sub.send(payload);
          return;
        }
        const kind = row.type === "comment" ? "item" : "conversation";
        if (await this.allowed(sub, kind, row.conversationId)) sub.send(payload);
      })
    );
  }

  private async allowed(sub: Sub, kind: "conversation" | "item", id: string): Promise<boolean> {
    const key = `${kind}:${id}`;
    const cached = sub.access.get(key);
    if (cached && this.now() - cached.at < this.accessTtlMs) return cached.ok;
    const ok = await this.deps.canAccess({ userId: sub.userId, role: sub.role }, kind, id);
    sub.access.set(key, { ok, at: this.now() });
    return ok;
  }
}

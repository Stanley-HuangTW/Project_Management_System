import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import {
  hashToken,
  randomToken,
  verifyPkce,
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
} from "@/lib/oauth/params";

/**
 * OAuth 的資料庫那一半:發碼、換權杖、驗權杖。
 *
 * 參數檢查全部在 params.ts(那一支測得到),這裡只處理需要碰資料庫的部分。
 */

/** 這台伺服器對外的位址。metadata 與 audience 都要用它。 */
export function issuer(): string {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export async function findClient(clientId: string) {
  return prisma.oAuthClient.findUnique({ where: { clientId } });
}

/** 使用者按下「允許」之後發一張一次性的授權碼。 */
export async function issueAuthCode(input: {
  clientRowId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
}): Promise<string> {
  const code = randomToken();
  await prisma.oAuthCode.create({
    data: {
      hashedCode: hashToken(code),
      clientId: input.clientRowId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

async function mintTokens(input: {
  clientRowId: string;
  userId: string;
  resource: string | null;
}): Promise<TokenPair> {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const now = Date.now();
  await prisma.oAuthToken.create({
    data: {
      hashedAccessToken: hashToken(accessToken),
      hashedRefreshToken: hashToken(refreshToken),
      clientId: input.clientRowId,
      userId: input.userId,
      resource: input.resource,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  });
  return { accessToken, refreshToken, expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export type ExchangeResult =
  | { ok: true; tokens: TokenPair }
  | { ok: false; error: string; description: string };

/**
 * 拿授權碼換權杖。
 *
 * 四道關卡缺一不可:碼存在、沒過期、沒用過、而且 client 與 redirect_uri
 * 跟當初發碼時完全一樣,最後 PKCE 的 verifier 要對得上。
 *
 * 用過的碼再送一次不只是拒絕 —— 連同那張碼已經發出去的權杖一起撤銷。
 * 一張碼被用兩次,代表它很可能被攔截了,這時候保住資料比保住連線重要。
 */
export async function exchangeAuthCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<ExchangeResult> {
  const row = await prisma.oAuthCode.findUnique({
    where: { hashedCode: hashToken(input.code) },
    include: { client: true },
  });
  if (!row) return { ok: false, error: "invalid_grant", description: "授權碼無效" };

  if (row.usedAt) {
    // 重放。把這張碼換出去的權杖全部撤掉。
    await prisma.oAuthToken.updateMany({
      where: { userId: row.userId, clientId: row.clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, error: "invalid_grant", description: "授權碼已經用過了,相關權杖已一併撤銷" };
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant", description: "授權碼已過期" };
  }
  if (row.client.clientId !== input.clientId) {
    return { ok: false, error: "invalid_grant", description: "授權碼不屬於這個 client" };
  }
  if (row.redirectUri !== input.redirectUri) {
    return { ok: false, error: "invalid_grant", description: "redirect_uri 跟發碼時不一致" };
  }
  if (!verifyPkce(input.codeVerifier, row.codeChallenge, "S256")) {
    return { ok: false, error: "invalid_grant", description: "code_verifier 不正確" };
  }

  // 先標成用過再發權杖 —— 反過來的話,中間失敗會留下一張已發權杖但還能再
  // 用一次的碼。
  await prisma.oAuthCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  const tokens = await mintTokens({
    clientRowId: row.clientId,
    userId: row.userId,
    resource: row.resource,
  });
  return { ok: true, tokens };
}

/** 更新權杖換一組新的。舊的那一組同時失效 —— 更新權杖是一次性的。 */
export async function refreshTokens(input: {
  refreshToken: string;
  clientId: string;
}): Promise<ExchangeResult> {
  const row = await prisma.oAuthToken.findUnique({
    where: { hashedRefreshToken: hashToken(input.refreshToken) },
    include: { client: true },
  });
  if (!row) return { ok: false, error: "invalid_grant", description: "更新權杖無效" };
  if (row.revokedAt) return { ok: false, error: "invalid_grant", description: "這張權杖已經撤銷" };
  if (row.client.clientId !== input.clientId) {
    return { ok: false, error: "invalid_grant", description: "權杖不屬於這個 client" };
  }
  if (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant", description: "更新權杖已過期,請重新授權" };
  }

  await prisma.oAuthToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  const tokens = await mintTokens({
    clientRowId: row.clientId,
    userId: row.userId,
    resource: row.resource,
  });
  return { ok: true, tokens };
}

/**
 * 拿存取權杖換出當初授權那個人的身分。
 *
 * 回的是跟登入時一模一樣的 session —— 所有既有的看板篩選因此原封不動套用,
 * 權杖永遠不會比授權它的人看得更多。角色也是現在查的,不是發權杖當下凍結
 * 的:一個人被降成 MEMBER 之後,他先前發出去的權杖立刻跟著降。
 */
export async function sessionFromOAuthToken(token: string): Promise<SessionPayload | null> {
  const row = await prisma.oAuthToken.findUnique({
    where: { hashedAccessToken: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  if (!row || row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  await prisma.oAuthToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return {
    userId: row.user.id,
    email: row.user.email,
    name: row.user.name,
    role: row.user.role,
  };
}

/** 過期的碼與權杖沒有留著的理由,順手清掉。 */
export async function pruneExpired(): Promise<void> {
  const now = new Date();
  await prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.oAuthToken.deleteMany({
    where: { refreshExpiresAt: { lt: now } },
  });
}

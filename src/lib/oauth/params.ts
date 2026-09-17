import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * OAuth 2.1 的參數檢查。
 *
 * 這個檔案不碰資料庫,所以整個測得到 —— 而這一層正是出錯就會把整個資料庫
 * 送出去的地方,測得到比什麼都重要。
 *
 * 一律往「拒絕」的方向失敗:看不懂的參數、對不上的網址、缺少的欄位,全部
 * 擋下來而不是猜使用者的意思。這是對外開放的端點,猜錯一次就沒有第二次。
 */

export type Check<T> = { ok: true; value: T } | { ok: false; error: string; description: string };

const fail = (error: string, description: string): Check<never> => ({ ok: false, error, description });

// ---- 權杖 ----

/** 授權碼、存取權杖、更新權杖都用這個長度。32 bytes = 256 bits。 */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 資料庫裡存的是雜湊。
 *
 * 跟 API 金鑰同一個道理:權杖本身是隨機位元組,沒有字典可以查,不加鹽才
 * 能用一次等值查詢找到它。外流的資料庫備份裡不會有能用的權杖。
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** SHA-256 的十六進位摘要長度。 */
const DIGEST_HEX_LENGTH = 64;
const HEX = /^[0-9a-f]+$/i;

/**
 * 比對兩個十六進位摘要,不洩漏它們從第幾個字元開始不同。
 *
 * 兩邊都得先是合法的摘要才比:`Buffer.from("zzzz", "hex")` 會安靜地回一個
 * 空 buffer,於是兩個都不合法的值會被判定成相同。目前的呼叫端傳進來的一定
 * 是我們自己算的摘要,所以踩不到 —— 但這是一支守著權杖的比較函式,不該
 * 建立在「呼叫端一定不會傳錯」上面。
 */
export function tokenMatches(a: string, b: string): boolean {
  if (a.length !== DIGEST_HEX_LENGTH || b.length !== DIGEST_HEX_LENGTH) return false;
  if (!HEX.test(a) || !HEX.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

// ---- PKCE ----

/**
 * 只收 S256。
 *
 * 規格允許 `plain`,但 `plain` 的 code_challenge 就是 verifier 本身 ——
 * 攔截到授權請求的人直接就拿到了 verifier,PKCE 等於沒做。OAuth 2.1 已經
 * 把它拿掉了,這裡也不留。
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== "S256") return false;
  // 規格要求 43–128 字元。太短的 verifier 猜得出來。
  if (verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  // 兩邊都是 base64url,長度一樣,用固定時間比較。
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

// ---- 導向網址 ----

/**
 * 註冊時可以收哪些導向網址。
 *
 * https 一律可以;http 只開給 localhost 與 127.0.0.1(本機用戶端沒有憑證,
 * 但流量也不出這台機器)。其餘一概拒絕 —— 自訂 scheme 在這裡沒有必要,而
 * 每多收一種就多一種把授權碼送去別處的方法。
 *
 * 帶片段(#)的一律拒絕:規格禁止,而且片段不會送到伺服器,擋不住。
 */
export function checkRedirectUri(raw: string): Check<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("invalid_redirect_uri", `「${raw}」不是合法的網址`);
  }

  if (url.hash) return fail("invalid_redirect_uri", "導向網址不可以帶片段(#)");

  if (url.protocol === "https:") return { ok: true, value: raw };

  if (url.protocol === "http:") {
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return { ok: true, value: raw };
    }
    return fail("invalid_redirect_uri", "http 的導向網址只開放 localhost");
  }

  return fail("invalid_redirect_uri", "導向網址必須是 https(或 http://localhost)");
}

/**
 * 授權請求裡的 redirect_uri 要跟註冊過的**完全一樣**。
 *
 * 不做前綴比對也不做子路徑比對:註冊了 `https://x.com/cb` 就只有
 * `https://x.com/cb`。前綴比對會讓 `https://x.com/cb.evil.com` 這種東西
 * 通過,授權碼就送到別人手上了。
 */
export function matchRedirectUri(registered: string[], requested: string): boolean {
  return registered.includes(requested);
}

// ---- 授權請求 ----

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope: string | null;
  /** RFC 8707:這張權杖是要給哪個資源用的。 */
  resource: string | null;
};

export function parseAuthorizeParams(params: URLSearchParams): Check<AuthorizeParams> {
  const responseType = params.get("response_type");
  if (responseType !== "code") {
    return fail("unsupported_response_type", "只支援 response_type=code");
  }

  const clientId = params.get("client_id");
  if (!clientId) return fail("invalid_request", "缺少 client_id");

  const redirectUri = params.get("redirect_uri");
  if (!redirectUri) return fail("invalid_request", "缺少 redirect_uri");

  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge) return fail("invalid_request", "缺少 code_challenge(本端點強制 PKCE)");
  if (codeChallenge.length < 43 || codeChallenge.length > 128) {
    return fail("invalid_request", "code_challenge 長度不對");
  }
  if (!/^[A-Za-z0-9\-_]+$/.test(codeChallenge)) {
    return fail("invalid_request", "code_challenge 必須是 base64url");
  }

  const method = params.get("code_challenge_method");
  if (method !== "S256") {
    return fail("invalid_request", "code_challenge_method 只支援 S256");
  }

  return {
    ok: true,
    value: {
      clientId,
      redirectUri,
      state: params.get("state"),
      codeChallenge,
      codeChallengeMethod: "S256",
      scope: params.get("scope"),
      resource: params.get("resource"),
    },
  };
}

// ---- 動態註冊 ----

export type RegistrationRequest = {
  clientName: string;
  redirectUris: string[];
};

/** 註冊一個新的用戶端。名稱只是顯示用,真正把關的是導向網址。 */
export function parseRegistration(body: unknown): Check<RegistrationRequest> {
  if (typeof body !== "object" || body === null) {
    return fail("invalid_client_metadata", "請求內容必須是 JSON 物件");
  }
  const input = body as Record<string, unknown>;

  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return fail("invalid_client_metadata", "redirect_uris 必填,而且至少要一個");
  }
  if (uris.length > 10) {
    return fail("invalid_client_metadata", "redirect_uris 最多 10 個");
  }

  const checked: string[] = [];
  for (const uri of uris) {
    if (typeof uri !== "string") {
      return fail("invalid_client_metadata", "redirect_uris 裡每一項都要是字串");
    }
    const result = checkRedirectUri(uri);
    if (!result.ok) return result;
    checked.push(result.value);
  }

  // grant_types 有帶就要是我們支援的那兩種。沒帶就用預設。
  const grants = input.grant_types;
  if (Array.isArray(grants)) {
    const allowed = new Set(["authorization_code", "refresh_token"]);
    for (const g of grants) {
      if (typeof g !== "string" || !allowed.has(g)) {
        return fail("invalid_client_metadata", `不支援的 grant_type:${String(g)}`);
      }
    }
  }

  const name = typeof input.client_name === "string" ? input.client_name.trim() : "";
  return {
    ok: true,
    value: { clientName: (name || "未命名的用戶端").slice(0, 80), redirectUris: checked },
  };
}

// ---- 錯誤導向 ----

/**
 * 把錯誤送回用戶端的導向網址。
 *
 * 只有在 redirect_uri 已經驗證過屬於這個 client 的時候才可以這樣做 ——
 * 還沒驗證就往那個網址導,等於做了一個開放轉址,任何人都能拿這個端點把
 * 別人送去任意網站。
 */
export function errorRedirect(redirectUri: string, error: string, description: string, state: string | null): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state !== null) url.searchParams.set("state", state);
  return url.toString();
}

export function successRedirect(redirectUri: string, code: string, state: string | null): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state !== null) url.searchParams.set("state", state);
  return url.toString();
}

/** 授權碼活得短 —— 它只需要活到用戶端把它換成權杖為止。 */
export const AUTH_CODE_TTL_MS = 60_000;
/** 存取權杖一小時,更新權杖三十天。 */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

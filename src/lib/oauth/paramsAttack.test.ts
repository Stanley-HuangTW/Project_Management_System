import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "crypto";
import {
  verifyPkce,
  checkRedirectUri,
  matchRedirectUri,
  parseAuthorizeParams,
  parseRegistration,
  errorRedirect,
  hashToken,
  tokenMatches,
  randomToken,
} from "@/lib/oauth/params";

/**
 * 攻擊面測試。
 *
 * 跟 sqlGuardAttack 分開的理由一樣:只用作者自己想到的規則去測作者自己寫
 * 的閘門,證明不了什麼。這裡每一條都是「如果這關沒守住,會發生什麼壞事」。
 *
 * 這一層失守的後果是別人拿到一張能讀整個資料庫的權杖,所以往拒絕的方向失
 * 敗永遠是對的。
 */

const verifierOf = (seed: string) => seed.padEnd(43, "x").slice(0, 43);
const challengeFor = (v: string) => createHash("sha256").update(v).digest("base64url");

const authParams = (overrides: Record<string, string | null> = {}) => {
  const verifier = verifierOf("legit-verifier");
  const base: Record<string, string | null> = {
    response_type: "code",
    client_id: "c1",
    redirect_uri: "https://claude.ai/cb",
    code_challenge: challengeFor(verifier),
    code_challenge_method: "S256",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== null) params.set(k, v);
  return params;
};

describe("PKCE:攔截到授權請求也換不到權杖", () => {
  it("正確的 verifier 過得了", () => {
    const v = verifierOf("correct-horse-battery-staple");
    expect(verifyPkce(v, challengeFor(v), "S256")).toBe(true);
  });

  it("換一個 verifier 就過不了", () => {
    const v = verifierOf("correct-horse-battery-staple");
    expect(verifyPkce(verifierOf("attacker"), challengeFor(v), "S256")).toBe(false);
  });

  it("plain 一律拒絕 —— 那等於沒做 PKCE", () => {
    // plain 的 challenge 就是 verifier 本身,攔到請求的人直接就有 verifier。
    const v = verifierOf("whatever");
    expect(verifyPkce(v, v, "plain")).toBe(false);
  });

  it("空的 method 不會被當成預設值放行", () => {
    const v = verifierOf("whatever");
    expect(verifyPkce(v, challengeFor(v), "")).toBe(false);
  });

  it("大小寫換一下也不行,S256 就是 S256", () => {
    const v = verifierOf("whatever");
    expect(verifyPkce(v, challengeFor(v), "s256")).toBe(false);
  });

  it("太短的 verifier 拒絕 —— 短到猜得出來就失去意義", () => {
    const short = "abc";
    expect(verifyPkce(short, challengeFor(short), "S256")).toBe(false);
  });

  it("太長的也拒絕", () => {
    const long = "a".repeat(129);
    expect(verifyPkce(long, challengeFor(long), "S256")).toBe(false);
  });

  it("verifier 裡有規格外的字元就拒絕", () => {
    const weird = `${"a".repeat(42)}%`;
    expect(verifyPkce(weird, challengeFor(weird), "S256")).toBe(false);
  });

  it("空字串 challenge 不會誤判成相符", () => {
    expect(verifyPkce(verifierOf("x"), "", "S256")).toBe(false);
  });
});

describe("導向網址:授權碼不能被送去別的地方", () => {
  it("https 可以", () => {
    expect(checkRedirectUri("https://claude.ai/cb").ok).toBe(true);
  });

  it("http 的外部網址拒絕 —— 授權碼會用明文飛出去", () => {
    expect(checkRedirectUri("http://evil.com/cb").ok).toBe(false);
  });

  it("http 的 localhost 可以,流量不出這台機器", () => {
    expect(checkRedirectUri("http://localhost:1234/cb").ok).toBe(true);
    expect(checkRedirectUri("http://127.0.0.1:1234/cb").ok).toBe(true);
  });

  it("javascript: 拒絕", () => {
    expect(checkRedirectUri("javascript:alert(1)").ok).toBe(false);
  });

  it("data: 拒絕", () => {
    expect(checkRedirectUri("data:text/html,<script>").ok).toBe(false);
  });

  it("file: 拒絕", () => {
    expect(checkRedirectUri("file:///etc/passwd").ok).toBe(false);
  });

  it("帶片段的拒絕 —— 片段不會送到伺服器,擋不住", () => {
    expect(checkRedirectUri("https://claude.ai/cb#x").ok).toBe(false);
  });

  it("根本不是網址的拒絕", () => {
    expect(checkRedirectUri("not a url").ok).toBe(false);
  });

  it("空字串拒絕", () => {
    expect(checkRedirectUri("").ok).toBe(false);
  });
});

describe("導向網址比對:完全相同才算", () => {
  const registered = ["https://claude.ai/cb"];

  it("一模一樣才過", () => {
    expect(matchRedirectUri(registered, "https://claude.ai/cb")).toBe(true);
  });

  it("前綴相同但主機不同 —— 這是把授權碼送去別人家的經典手法", () => {
    expect(matchRedirectUri(registered, "https://claude.ai.evil.com/cb")).toBe(false);
  });

  it("多一層路徑不算", () => {
    expect(matchRedirectUri(registered, "https://claude.ai/cb/extra")).toBe(false);
  });

  it("多一個查詢參數不算", () => {
    expect(matchRedirectUri(registered, "https://claude.ai/cb?next=evil")).toBe(false);
  });

  it("尾巴多一條斜線不算", () => {
    expect(matchRedirectUri(registered, "https://claude.ai/cb/")).toBe(false);
  });

  it("沒註冊過的一律不過", () => {
    expect(matchRedirectUri([], "https://claude.ai/cb")).toBe(false);
  });
});

describe("授權請求的參數", () => {
  it("正常的請求解得出來", () => {
    const result = parseAuthorizeParams(authParams());
    expect(result.ok).toBe(true);
  });

  it("沒有 code_challenge 就拒絕 —— 本端點強制 PKCE", () => {
    const result = parseAuthorizeParams(authParams({ code_challenge: null }));
    expect(result.ok).toBe(false);
  });

  it("method 是 plain 就拒絕", () => {
    const result = parseAuthorizeParams(authParams({ code_challenge_method: "plain" }));
    expect(result.ok).toBe(false);
  });

  it("沒帶 method 不會默默當成 plain", () => {
    const result = parseAuthorizeParams(authParams({ code_challenge_method: null }));
    expect(result.ok).toBe(false);
  });

  it("response_type=token(隱含流程)拒絕", () => {
    // 隱含流程會把權杖直接放進網址列,OAuth 2.1 已經移除。
    const result = parseAuthorizeParams(authParams({ response_type: "token" }));
    expect(result.ok).toBe(false);
  });

  it("缺 client_id 拒絕", () => {
    expect(parseAuthorizeParams(authParams({ client_id: null })).ok).toBe(false);
  });

  it("缺 redirect_uri 拒絕 —— 不會退回用註冊的第一個", () => {
    expect(parseAuthorizeParams(authParams({ redirect_uri: null })).ok).toBe(false);
  });

  it("challenge 不是 base64url 就拒絕", () => {
    expect(parseAuthorizeParams(authParams({ code_challenge: "!".repeat(43) })).ok).toBe(false);
  });

  it("state 沒帶也可以,但會如實留成 null", () => {
    const result = parseAuthorizeParams(authParams());
    expect(result.ok && result.value.state).toBe(null);
  });
});

describe("動態註冊", () => {
  it("正常的註冊過得了", () => {
    const result = parseRegistration({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/cb"],
    });
    expect(result.ok).toBe(true);
  });

  it("一個 http 外部網址就整包拒絕,不是默默跳過那一個", () => {
    const result = parseRegistration({
      redirect_uris: ["https://claude.ai/cb", "http://evil.com/cb"],
    });
    expect(result.ok).toBe(false);
  });

  it("沒有 redirect_uris 拒絕", () => {
    expect(parseRegistration({ client_name: "x" }).ok).toBe(false);
  });

  it("空陣列拒絕", () => {
    expect(parseRegistration({ redirect_uris: [] }).ok).toBe(false);
  });

  it("不是陣列拒絕", () => {
    expect(parseRegistration({ redirect_uris: "https://claude.ai/cb" }).ok).toBe(false);
  });

  it("裡面混了非字串就拒絕", () => {
    expect(parseRegistration({ redirect_uris: ["https://claude.ai/cb", 42] }).ok).toBe(false);
  });

  it("塞一百個網址拒絕", () => {
    const many = Array.from({ length: 100 }, (_, i) => `https://claude.ai/cb${i}`);
    expect(parseRegistration({ redirect_uris: many }).ok).toBe(false);
  });

  it("要求 client_credentials 這種不給人用的 grant 就拒絕", () => {
    const result = parseRegistration({
      redirect_uris: ["https://claude.ai/cb"],
      grant_types: ["client_credentials"],
    });
    expect(result.ok).toBe(false);
  });

  it("null 拒絕", () => {
    expect(parseRegistration(null).ok).toBe(false);
  });

  it("字串拒絕", () => {
    expect(parseRegistration("redirect_uris=x").ok).toBe(false);
  });

  it("超長的名稱會被截短,不會整包吃進資料庫", () => {
    const result = parseRegistration({
      client_name: "長".repeat(500),
      redirect_uris: ["https://claude.ai/cb"],
    });
    expect(result.ok && result.value.clientName.length).toBe(80);
  });

  it("沒給名稱會有一個預設的,不是空字串", () => {
    const result = parseRegistration({ redirect_uris: ["https://claude.ai/cb"] });
    expect(result.ok && result.value.clientName).toBe("未命名的用戶端");
  });
});

describe("權杖", () => {
  it("每次都不一樣", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(seen.size).toBe(200);
  });

  it("雜湊不是原文", () => {
    const token = randomToken();
    expect(hashToken(token)).not.toBe(token);
  });

  it("同樣的權杖雜湊出同一個值", () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("比對相符", () => {
    const h = hashToken(randomToken());
    expect(tokenMatches(h, h)).toBe(true);
  });

  it("比對不符", () => {
    expect(tokenMatches(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("長度不同不會丟例外,只是回 false", () => {
    expect(tokenMatches("abcd", hashToken("x"))).toBe(false);
  });

  it("兩個都不是合法摘要時不會被判定成相同", () => {
    // Buffer.from("zzzz","hex") 會安靜地回一個空 buffer,兩個空的比起來
    // 是相等的 —— 沒有先擋下來的話,這裡會回 true。
    expect(tokenMatches("zzzz", "zzzz")).toBe(false);
  });

  it("長度對但不是十六進位也不算", () => {
    expect(tokenMatches("z".repeat(64), "z".repeat(64))).toBe(false);
  });

  it("摘要長度不對就不算,即使字面上一樣", () => {
    expect(tokenMatches("ab", "ab")).toBe(false);
  });

  it("權杖夠長,猜不出來", () => {
    // 32 bytes 的 base64url 是 43 個字元。
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });
});

describe("錯誤導向", () => {
  it("state 原樣送回去 —— 用戶端靠它擋 CSRF", () => {
    const url = errorRedirect("https://claude.ai/cb", "access_denied", "使用者拒絕", "abc123");
    expect(new URL(url).searchParams.get("state")).toBe("abc123");
  });

  it("沒有 state 就不會多生一個出來", () => {
    const url = errorRedirect("https://claude.ai/cb", "access_denied", "使用者拒絕", null);
    expect(new URL(url).searchParams.has("state")).toBe(false);
  });

  it("原本就有查詢參數的網址不會被蓋掉", () => {
    const url = errorRedirect("https://claude.ai/cb?keep=1", "access_denied", "x", null);
    expect(new URL(url).searchParams.get("keep")).toBe("1");
  });

  it("錯誤描述裡的特殊字元會被編碼,不會跑出參數之外", () => {
    const url = errorRedirect("https://claude.ai/cb", "invalid_request", "a&b=c#d", null);
    expect(new URL(url).searchParams.get("error_description")).toBe("a&b=c#d");
  });
});

describe("隨機性", () => {
  it("randomBytes 真的有在用 —— 兩次雜湊不會相同", () => {
    expect(hashToken(randomBytes(32).toString("hex"))).not.toBe(
      hashToken(randomBytes(32).toString("hex"))
    );
  });
});

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * 把外部系統的 API token 這類機敏字串加密後存進資料庫(AES-256-GCM)。
 *
 * 金鑰由 AUTH_SECRET 推出來,所以資料庫單獨外流看不到明文;但 AUTH_SECRET 換掉之後,舊的密文就解不開了——
 * 解不開時回 null,呼叫端請使用者重新輸入。格式:v1.{iv}.{tag}.{密文},各段都是 base64url。
 */
const PREFIX = "v1";

function keyFor(secret: string): Buffer {
  return createHash("sha256").update(`secret-box:${secret}`).digest();
}

function currentSecret(): string {
  return process.env.AUTH_SECRET ?? "insecure-dev-secret";
}

export function encryptSecret(plain: string, secret: string = currentSecret()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/** 解不開(金鑰換了、資料被改過、格式不對)回 null,不丟例外。 */
export function decryptSecret(stored: string, secret: string = currentSecret()): string | null {
  const [prefix, iv, tag, body] = stored.split(".");
  if (prefix !== PREFIX || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

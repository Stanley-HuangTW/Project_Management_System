import { createHash, randomBytes, timingSafeEqual } from "crypto";

const PREFIX = "hrapp_";
/** How much of the key is shown in the list, enough to tell two apart. */
const VISIBLE = PREFIX.length + 6;

/** A fresh key. Returned once, to the person who asked for it — after that
 *  only the hash exists, so nobody (including this app) can read it back. */
export function generateApiKey(): string {
  return PREFIX + randomBytes(24).toString("hex");
}

/** What actually goes in the database. SHA-256 with no salt on purpose: the
 *  key is 24 random bytes, so there is no dictionary to defend against, and
 *  an unsalted hash is what makes a constant-time lookup by key possible. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The head of the key, shown in the list: "hrapp_1a2b3c…". */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, VISIBLE);
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(PREFIX) && value.length > VISIBLE;
}

/** Compares two hex digests without leaking where they differ. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Reads the key out of an Authorization header, in either of the two forms
 *  people actually send. */
export function readBearerToken(header: string | null): string | null {
  if (!header) return null;
  // The scheme is stripped before trimming: "Bearer " trims to "Bearer",
  // which would otherwise be returned as if the word itself were the key.
  const match = /^\s*bearer\s+(.*)$/i.exec(header);
  const token = (match ? match[1] : header).trim();
  return token && !/^bearer$/i.test(token) ? token : null;
}

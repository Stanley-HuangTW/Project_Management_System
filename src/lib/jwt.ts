import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

const secretKey = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "insecure-dev-secret"
);

export type SessionPayload = {
  userId: string;
  email: string;
  name: string;
  role: "ADMIN" | "SUPERVISOR" | "MEMBER";
  /** 管理者以別人的身分檢視時:上面四個欄位是被檢視的人,這兩個才是真正在操作的管理者。 */
  impersonatorId?: string;
  impersonatorName?: string;
};

export async function createSessionToken(payload: SessionPayload, durationSeconds = SESSION_DURATION_SECONDS) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${durationSeconds}s`)
    .sign(secretKey);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey, looksLikeApiKey, readBearerToken } from "@/lib/apiKey";
import type { SessionPayload } from "@/lib/jwt";

/**
 * Turns an API key into the session it acts as.
 *
 * The key has no permissions of its own — it borrows its owner's, so every
 * board filter already written for the UI applies unchanged and the API can
 * never show more than the person who issued the key can see.
 */
export async function sessionFromApiKey(request: Request): Promise<SessionPayload | null> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token || !looksLikeApiKey(token)) return null;

  const key = await prisma.apiKey.findUnique({
    where: { hashedKey: hashApiKey(token) },
    include: { owner: { select: { id: true, email: true, name: true, role: true } } },
  });
  if (!key) return null;

  // Best-effort: a failed bookkeeping write must not fail the request.
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { userId: key.owner.id, email: key.owner.email, name: key.owner.name, role: key.owner.role };
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "需要有效的 API 金鑰,請在 Authorization 標頭帶 Bearer <key>" },
    { status: 401 }
  );
}

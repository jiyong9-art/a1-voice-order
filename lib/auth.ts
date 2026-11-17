import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { appConfig } from "@/lib/env";
import type { SessionUser } from "@/lib/types";

export const SESSION_COOKIE = "inu_session";
const SESSION_DAYS = 7;
const MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

function secret(): string {
  const c = appConfig();
  // APP_SESSION_SECRET이 없으면 팀 비밀번호를 서명 키로 사용합니다.
  // (비밀번호를 바꾸면 기존 로그인이 모두 풀립니다.)
  return c.sessionSecret || c.passcode || "inu-dev-only-secret";
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function createSessionToken(name: string): string {
  const payload: SessionUser = { name, exp: Date.now() + MAX_AGE_SECONDS * 1000 };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionUser;
    if (!parsed?.name || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 서버 컴포넌트 / 라우트 핸들러에서 현재 로그인 사용자 조회 */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** 타이밍 공격을 막는 문자열 비교 */
export function safeEqual(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

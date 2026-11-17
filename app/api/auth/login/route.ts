import { NextResponse } from "next/server";
import { createSessionToken, safeEqual, SESSION_COOKIE } from "@/lib/auth";
import { appConfig, defaultTeamMembers } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limit = rateLimit(`login:${clientIp(request)}`, 12, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `로그인 시도가 너무 많습니다. ${limit.retryAfterSec}초 후 다시 시도해 주세요.` },
      { status: 429 },
    );
  }

  const c = appConfig();
  if (!c.passcode) {
    return NextResponse.json(
      { ok: false, error: "APP_PASSCODE가 설정되지 않았습니다. 서버 환경변수를 먼저 등록해 주세요." },
      { status: 500 },
    );
  }

  let body: { name?: string; passcode?: string };
  try {
    body = (await request.json()) as { name?: string; passcode?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 20);
  const passcode = (body.passcode ?? "").trim();

  if (!name) {
    return NextResponse.json({ ok: false, error: "이름을 선택해 주세요." }, { status: 400 });
  }
  if (!safeEqual(passcode, c.passcode)) {
    return NextResponse.json({ ok: false, error: "팀 비밀번호가 맞지 않습니다." }, { status: 401 });
  }

  const known = defaultTeamMembers();
  if (!known.includes(name) && name.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "이름을 확인해 주세요." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, name });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(name),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return response;
}

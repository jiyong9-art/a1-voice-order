import { NextResponse } from "next/server";
import { getSession, safeEqual } from "@/lib/auth";
import { appConfig } from "@/lib/env";
import { addMember, listMembers, removeMember, type MembersState } from "@/lib/members";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  name?: unknown;
  passcode?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function readBody(request: Request): Promise<Body> {
  try {
    const parsed = (await request.json()) as Body;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function statePayload(state: MembersState) {
  return {
    members: state.members,
    count: state.members.length,
    source: state.source,
    persistent: state.persistent,
    warning: state.warning,
  };
}

/** 로그인 세션 또는 요청 body의 팀 비밀번호로 확인합니다. */
async function authorize(
  request: Request,
  body: Body,
): Promise<{ ok: true; via: "session" | "passcode" } | { ok: false; response: NextResponse }> {
  const session = await getSession();
  if (session) return { ok: true, via: "session" };

  const passcode = appConfig().passcode;
  if (!passcode) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "팀 비밀번호(APP_PASSCODE)가 설정되지 않아 직원 목록을 변경할 수 없습니다." },
        { status: 500 },
      ),
    };
  }
  if (safeEqual(text(body.passcode).trim(), passcode)) return { ok: true, via: "passcode" };

  return {
    ok: false,
    response: NextResponse.json({ ok: false, error: "팀 비밀번호가 맞지 않습니다." }, { status: 401 }),
  };
}

/** 직원 목록 조회 (로그인 화면에서도 불러오므로 공개) */
export async function GET(request: Request) {
  const limit = rateLimit(`members:get:${clientIp(request)}`, 240, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `요청이 너무 많습니다. ${limit.retryAfterSec}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const state = await listMembers();
    return NextResponse.json(
      { ok: true, ...statePayload(state) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `직원 목록을 불러오지 못했습니다. (${message.slice(0, 200)})` },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** 직원 추가 — 이름 없이 passcode만 보내면 비밀번호 확인만 합니다. */
export async function POST(request: Request) {
  const body = await readBody(request);
  const limit = rateLimit(`members:post:${clientIp(request)}`, 40, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `요청이 너무 많습니다. ${limit.retryAfterSec}초 후 다시 시도해 주세요.` },
      { status: 429 },
    );
  }

  const auth = await authorize(request, body);
  if (!auth.ok) return auth.response;

  const name = text(body.name).trim();

  // passcode 확인만 요청한 경우
  if (!name) {
    const state = await listMembers();
    return NextResponse.json({ ok: true, verified: true, ...statePayload(state) });
  }

  try {
    const result = await addMember(name);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, ...(result.state ? statePayload(result.state) : {}) },
        { status: 400 },
      );
    }
    const state = result.state ?? (await listMembers());
    return NextResponse.json({ ok: true, added: name, ...statePayload(state), warning: result.warning ?? state.warning });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `직원을 추가하지 못했습니다. (${message.slice(0, 200)})` },
      { status: 500 },
    );
  }
}

/** 직원 삭제 */
export async function DELETE(request: Request) {
  const body = await readBody(request);
  const limit = rateLimit(`members:delete:${clientIp(request)}`, 40, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `요청이 너무 많습니다. ${limit.retryAfterSec}초 후 다시 시도해 주세요.` },
      { status: 429 },
    );
  }

  const auth = await authorize(request, body);
  if (!auth.ok) return auth.response;

  const name = text(body.name).trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "삭제할 직원 이름을 지정해 주세요." }, { status: 400 });
  }

  try {
    const result = await removeMember(name);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, ...(result.state ? statePayload(result.state) : {}) },
        { status: 400 },
      );
    }
    const state = result.state ?? (await listMembers());
    return NextResponse.json({ ok: true, removed: name, ...statePayload(state), warning: result.warning ?? state.warning });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `직원을 삭제하지 못했습니다. (${message.slice(0, 200)})` },
      { status: 500 },
    );
  }
}

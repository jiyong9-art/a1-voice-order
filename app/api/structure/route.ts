import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { aiConfigured, mockAiEnabled, structureCallSummary, structureOrder } from "@/lib/ai";
import { listMembers } from "@/lib/members";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 담당자 이름을 직원목록(구글 시트) 기준으로 맞춥니다. 실패하면 기본 명단을 씁니다. */
async function teamNames(): Promise<string[] | undefined> {
  try {
    const state = await listMembers();
    return state.members.length > 0 ? state.members : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limit = rateLimit(`structure:${session.name}:${clientIp(request)}`, 60, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `요청이 너무 많습니다. ${Math.ceil(limit.retryAfterSec / 60)}분 후 다시 시도해 주세요.` },
      { status: 429 },
    );
  }

  if (!aiConfigured() && !mockAiEnabled()) {
    return NextResponse.json(
      { ok: false, error: "OPENAI_API_KEY가 설정되지 않았습니다. .env.local 또는 Vercel 환경변수를 확인해 주세요." },
      { status: 503 },
    );
  }

  let body: { mode?: string; transcript?: string };
  try {
    body = (await request.json()) as { mode?: string; transcript?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const transcript = (body.transcript ?? "").trim();
  if (transcript.length < 2) {
    return NextResponse.json({ ok: false, error: "정리할 내용이 비어 있습니다." }, { status: 400 });
  }
  if (transcript.length > 60_000) {
    return NextResponse.json(
      { ok: false, error: "내용이 너무 깁니다. 통화를 20분 이내로 나눠 올려 주세요." },
      { status: 413 },
    );
  }

  const mode = body.mode === "call_summary" ? "call_summary" : "order";

  try {
    if (mode === "call_summary") {
      const data = await structureCallSummary(transcript);
      data.raw_transcript = transcript;
      return NextResponse.json({ ok: true, mode, data });
    }
    const data = await structureOrder(transcript, session.name, await teamNames());
    data.raw_transcript = transcript;
    return NextResponse.json({ ok: true, mode, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `AI 정리에 실패했습니다. (${message.slice(0, 200)})` },
      { status: 500 },
    );
  }
}

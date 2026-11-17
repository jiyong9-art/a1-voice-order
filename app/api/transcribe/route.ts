import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { aiConfigured, mockAiEnabled, transcribeAudio } from "@/lib/ai";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 24 * 1024 * 1024; // OpenAI 업로드 한도 25MB에서 여유를 둡니다.

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limit = rateLimit(`transcribe:${session.name}:${clientIp(request)}`, 40, 60 * 60 * 1000);
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "업로드 데이터를 읽지 못했습니다." }, { status: 400 });
  }

  const audio = form.get("audio");
  const mode = form.get("mode") === "call_summary" ? "call_summary" : "order";

  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ ok: false, error: "오디오 파일이 없습니다." }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `파일이 너무 큽니다 (${(audio.size / 1024 / 1024).toFixed(1)}MB). 25MB 이하로 나눠 올려 주세요.`,
      },
      { status: 413 },
    );
  }

  try {
    const result = await transcribeAudio(audio, { mode });
    if (!result.text) {
      return NextResponse.json(
        { ok: false, error: "음성을 인식하지 못했습니다. 다시 말씀해 주세요." },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /401|incorrect api key|invalid api key/i.test(message) ? 401 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 401
            ? "OpenAI API 키가 올바르지 않습니다. OPENAI_API_KEY를 확인해 주세요."
            : `음성 변환에 실패했습니다. (${message.slice(0, 200)})`,
      },
      { status },
    );
  }
}

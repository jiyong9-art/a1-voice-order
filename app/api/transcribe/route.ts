import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { analyzeAudio, silenceReason } from "@/lib/audio-guard";
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
        error: `파일이 너무 큽니다 (${(audio.size / 1024 / 1024).toFixed(1)}MB). 25MB 이하로 나눠 올려 주세요.`,
        ok: false,
      },
      { status: 413 },
    );
  }

  // v1.8 무음·초단시간 게이트: 말소리가 없으면 모델을 부르지 않는다.
  // (Whisper 계열이 조용한 파일에서 고유명사 힌트를 그대로 읽어 내는 '빈칸 환각' 방지)
  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const profile = analyzeAudio(bytes);
    const reason = silenceReason(profile);
    if (reason) {
      return NextResponse.json({
        ok: true,
        text: "",
        silent: true,
        reason,
        // 웹 화면은 text 가 비면 이 문구를 그대로 보여 준다.
        error: "말소리가 들리지 않았습니다. 다시 말씀해 주세요.",
        model: "silence-gate",
        audio: {
          durationSec: profile.durationSec,
          rmsDb: Number.isFinite(profile.rmsDb) ? profile.rmsDb : null,
          speechSeconds: profile.speechSeconds,
        },
      });
    }
  } catch {
    // 게이트를 재지 못해도 변환은 그대로 진행한다(기존 동작 유지).
  }

  try {
    const result = await transcribeAudio(audio, { mode });
    if (!result.text) {
      if (result.silenced) {
        return NextResponse.json({
          ok: true,
          text: "",
          silent: true,
          reason: result.silenced,
          error: "말소리가 들리지 않았습니다. 다시 말씀해 주세요.",
          model: result.model,
          // 환각 판정의 근거(토큰 확신도). 화면에는 쓰지 않고, 기준을 점검할 때만 본다.
          confidence: result.confidence,
        });
      }
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

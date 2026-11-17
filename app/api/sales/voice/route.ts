import { NextResponse } from "next/server";
import { getSession, safeEqual } from "@/lib/auth";
import { aiConfigured, mockAiEnabled, transcribeAudio } from "@/lib/ai";
import { appConfig } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { maskDeep, maskSensitiveText, warningForMasking } from "@/lib/sales-privacy";
import { computeMissing, normalizeSalesDraft, readSalesDocument, structureSalesOrder } from "@/lib/sales-ai";
import type { SalesCustomer, SalesOrderDraft, SalesVoiceResponse } from "@/lib/types";

/**
 * POST /api/sales/voice — Sales 앱(GitHub Pages·로컬·Vercel)에서 부르는 영업 AI 통합 API.
 *
 * 입력(multipart/form-data 또는 application/json)
 *  - audio     : 음성 파일(최대 24MB) → 전사
 *  - text      : 문자·카톡 복붙 텍스트
 *  - image     : 서류 사진(사업자등록증·차량등록증·신분증) → Vision으로 구조화
 *  - customers : 선택 JSON 문자열 [{id, name, bizNo}] (고객명부 매칭 보조)
 *
 * 인증: 로그인 세션 쿠키 또는 x-a1-passcode 헤더(= APP_PASSCODE, 타이밍 안전 비교)
 *
 * 업로드 파일은 메모리에서만 처리하고 디스크에 저장하지 않으며, 응답 후 폐기한다.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const ALLOWED_ORIGINS = ["https://jiyong9-art.github.io", "https://a1-voice-order.vercel.app"];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // 로컬 개발: http://localhost:3000, http://127.0.0.1:5173 등
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-a1-passcode",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  // 허용하지 않는 출처의 프리플라이트는 거부한다(브라우저가 실제 요청을 보내지 않는다).
  if (origin && !isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403, headers: corsHeaders(null) });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

function json(body: SalesVoiceResponse, status: number, origin: string | null) {
  return NextResponse.json(body, { status, headers: { ...corsHeaders(origin), "Cache-Control": "no-store" } });
}

function isAuthorized(request: Request, session: Awaited<ReturnType<typeof getSession>>): boolean {
  if (session) return true;
  const headerPasscode = (request.headers.get("x-a1-passcode") ?? "").trim();
  const expected = appConfig().passcode;
  // APP_PASSCODE가 설정되어 있고 헤더 값이 정확히 같을 때만 통과(타이밍 안전 비교)
  return Boolean(expected) && headerPasscode.length > 0 && safeEqual(headerPasscode, expected);
}

interface CustomerRef {
  id?: string;
  name?: string;
  bizNo?: string;
}

function parseCustomers(raw: unknown): CustomerRef[] {
  if (raw === null || raw === undefined) return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      id: o.id === undefined || o.id === null ? "" : String(o.id).slice(0, 40),
      name: typeof o.name === "string" ? o.name.slice(0, 60) : "",
      bizNo: typeof o.bizNo === "string" ? o.bizNo.slice(0, 20) : "",
    };
  });
}

function dataUrlToFile(dataUrl: string): File | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  return new File([buffer], "document", { type: match[1] });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return json({ ok: false, transcript: "", error: "허용되지 않은 출처입니다." }, 403, null);
  }

  const ip = clientIp(request);
  const limit = rateLimit(`sales-voice:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) {
    return json(
      {
        ok: false,
        transcript: "",
        error: `요청이 너무 많습니다. ${Math.ceil(limit.retryAfterSec / 60)}분 후 다시 시도해 주세요.`,
      },
      429,
      origin,
    );
  }

  const session = await getSession();
  if (!isAuthorized(request, session)) {
    return json({ ok: false, transcript: "", error: "인증이 필요합니다. x-a1-passcode 헤더 또는 로그인 세션을 확인해 주세요." }, 401, origin);
  }

  if (!aiConfigured() && !mockAiEnabled()) {
    return json(
      { ok: false, transcript: "", error: "OPENAI_API_KEY가 설정되지 않았습니다. 서버 환경변수를 확인해 주세요." },
      503,
      origin,
    );
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  let audio: File | null = null;
  let image: File | null = null;
  let rawText = "";
  let customersRaw: unknown = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const audioField = form.get("audio");
      const imageField = form.get("image");
      const textField = form.get("text");
      if (audioField instanceof File && audioField.size > 0) audio = audioField;
      if (imageField instanceof File && imageField.size > 0) image = imageField;
      if (typeof textField === "string") rawText = textField;
      customersRaw = form.get("customers");
    } else if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.text === "string") rawText = body.text;
      customersRaw = body.customers ?? null;
      if (typeof body.image === "string" && body.image.trim()) {
        image = dataUrlToFile(body.image.trim());
        if (!image) {
          return json(
            { ok: false, transcript: "", error: "image는 data:image/...;base64,... 형식의 문자열이어야 합니다." },
            400,
            origin,
          );
        }
      }
    } else {
      return json(
        { ok: false, transcript: "", error: "multipart/form-data 또는 application/json으로 보내 주세요." },
        415,
        origin,
      );
    }
  } catch {
    return json({ ok: false, transcript: "", error: "요청 본문을 읽지 못했습니다." }, 400, origin);
  }

  if (audio && audio.size > MAX_AUDIO_BYTES) {
    return json(
      {
        ok: false,
        transcript: "",
        error: `음성 파일이 너무 큽니다 (${(audio.size / 1024 / 1024).toFixed(1)}MB). 24MB 이하로 나눠 주세요.`,
      },
      413,
      origin,
    );
  }
  if (image && image.size > MAX_IMAGE_BYTES) {
    return json(
      {
        ok: false,
        transcript: "",
        error: `서류 사진이 너무 큽니다 (${(image.size / 1024 / 1024).toFixed(1)}MB). 10MB 이하로 줄여 주세요.`,
      },
      413,
      origin,
    );
  }
  if (rawText.length > MAX_TEXT_CHARS) {
    return json({ ok: false, transcript: "", error: "텍스트가 너무 깁니다. 필요한 부분만 붙여넣어 주세요." }, 413, origin);
  }
  if (!audio && !image && rawText.trim().length < 2) {
    return json(
      { ok: false, transcript: "", error: "음성·텍스트·서류 사진 중 하나는 보내 주세요." },
      400,
      origin,
    );
  }

  const warnings: string[] = [];
  const transcriptParts: string[] = [];
  let docSummary = "";
  let docType = "";
  let docCustomer: SalesCustomer | null = null;
  let sttEngine = "none";
  let mocked = false;

  try {
    // 1) 평문 텍스트: 주민번호·카드번호를 먼저 가린다.
    if (rawText.trim()) {
      const maskedText = maskSensitiveText(rawText.trim());
      if (maskedText.masked) {
        const warning = warningForMasking(maskedText.rrn, maskedText.card);
        if (warning) warnings.push(warning);
      }
      transcriptParts.push(maskedText.text);
    }

    // 2) 서류 사진: 메모리에서만 읽고 요약을 만든다.
    if (image) {
      try {
        const doc = await readSalesDocument(image);
        docType = doc.doc_type;
        docSummary = doc.summary;
        docCustomer = doc.customer;
        if (doc.mocked) mocked = true;
        const maskedDoc = maskSensitiveText(docSummary);
        if (maskedDoc.masked) {
          const warning = warningForMasking(maskedDoc.rrn, maskedDoc.card);
          if (warning) warnings.push(`서류 사진: ${warning}`);
        }
        docSummary = maskedDoc.text;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`서류 사진을 읽지 못해 음성·텍스트만으로 정리했습니다. (${message.slice(0, 120)})`);
      }
    }

    // 3) 음성 파일: 전사 후 마스킹
    if (audio) {
      const transcribed = await transcribeAudio(audio, { mode: "sales" });
      sttEngine = transcribed.model;
      if (transcribed.mocked) mocked = true;
      const maskedTranscript = maskSensitiveText(transcribed.text);
      if (maskedTranscript.masked) {
        const warning = warningForMasking(maskedTranscript.rrn, maskedTranscript.card);
        if (warning) warnings.push(`음성 전사: ${warning}`);
      }
      if (maskedTranscript.text.trim()) transcriptParts.push(maskedTranscript.text.trim());
    }

    const transcript = transcriptParts.join("\n").trim();
    if (!transcript && !docSummary) {
      return json(
        { ok: false, transcript: "", error: "음성이나 텍스트에서 내용을 찾지 못했습니다. 다시 말씀해 주세요." },
        422,
        origin,
      );
    }

    // 4) 구조화: 전사 + 서류 요약 → SalesOrderDraft (MOCK_AI=1 이면 규칙 기반 초안)
    const customers = parseCustomers(customersRaw);
    const draft: SalesOrderDraft = await structureSalesOrder({
      transcript: transcript || docSummary,
      customers,
      docSummary,
      docType,
    });

    // 5) 서류에서 읽은 고객 정보로 빈 칸을 채우고, 전체를 한 번 더 마스킹한다.
    if (docCustomer) {
      const merged = draft.customer;
      for (const key of ["name", "biz_no", "phone", "address", "ceo_name"] as const) {
        if (!merged[key] && docCustomer[key]) merged[key] = docCustomer[key];
      }
      if (!merged.doc_type && docType) merged.doc_type = docType;
    }
    const maskedDraft = maskDeep(draft);
    if (maskedDraft.rrn > 0 || maskedDraft.card > 0) {
      const warning = warningForMasking(maskedDraft.rrn, maskedDraft.card);
      if (warning) warnings.push(`초안: ${warning}`);
    }
    const finalDraft = normalizeSalesDraft(maskedDraft.value, docType);
    finalDraft.missing = Array.from(new Set([...finalDraft.missing, ...computeMissing(finalDraft)]));

    const response: SalesVoiceResponse = {
      ok: true,
      transcript: transcript || docSummary,
      draft: finalDraft,
      warnings: warnings.length > 0 ? warnings : undefined,
      engine: {
        stt: sttEngine,
        model: mockAiEnabled() ? "mock" : appConfig().chatModel,
        mocked: mocked || mockAiEnabled(),
      },
    };
    return json(response, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /401|incorrect api key|invalid api key/i.test(message) ? 401 : 500;
    return json(
      {
        ok: false,
        transcript: transcriptParts.join("\n"),
        error:
          status === 401
            ? "OpenAI API 키가 올바르지 않습니다. 서버 환경변수를 확인해 주세요."
            : `영업 오더 정리에 실패했습니다. (${message.slice(0, 200)})`,
      },
      status,
      origin,
    );
  } finally {
    // 업로드 파일은 메모리 참조만 끊는다(디스크에 저장하지 않음).
    audio = null;
    image = null;
  }
}

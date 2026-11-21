import OpenAI from "openai";
import { appConfig, defaultTeamMembers, isSet, transcriptionPrompt, vocabularyHints } from "@/lib/env";
import { looksLikeHallucination } from "@/lib/audio-guard";
import type { CallSummaryResult, OrderResult, Priority } from "@/lib/types";
import { PRIORITIES, todayInSeoul } from "@/lib/types";

let client: OpenAI | null = null;

export function openai(): OpenAI {
  const c = appConfig();
  if (!c.openaiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!client) {
    client = new OpenAI({ apiKey: c.openaiKey, timeout: 120_000, maxRetries: 1 });
  }
  return client;
}

export function aiConfigured(): boolean {
  return isSet("OPENAI_API_KEY");
}

/** API 키 없이 화면·시트 연동만 시험해 볼 때 사용 (MOCK_AI=true) */
export function mockAiEnabled(): boolean {
  return appConfig().mockAi;
}

/* ------------------------------------------------------------------ */
/* 모드 A/B 공통: 음성 → 텍스트                                          */
/* ------------------------------------------------------------------ */

const MIME_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function normalizeAudioFile(file: File): { file: File; ext: string } {
  const rawName = file.name || "recording";
  const fromName = rawName.includes(".") ? rawName.split(".").pop()!.toLowerCase() : "";
  const fromMime = MIME_EXT[(file.type || "").toLowerCase()] ?? "";
  const ext = fromMime || fromName || "webm";
  const name = rawName.includes(".") ? rawName : `${rawName}.${ext}`;
  if (name === rawName) return { file, ext };
  return { file: new File([file], name, { type: file.type || "application/octet-stream" }), ext };
}

export type TranscriptionResult = {
  text: string;
  model: string;
  mocked?: boolean;
  /** 말소리가 아니라 빈칸·환각으로 판단해 비운 경우 (v1.8~) */
  silenced?: "prompt_echo" | "hallucination";
  /** 토큰 확신도 요약 (gpt-4o-transcribe logprobs, 없으면 없음) */
  confidence?: { avg: number; min: number };
};

/**
 * 모델이 돌려준 글에서 빈칸 환각을 걸러낸다 (v1.9).
 * 예: 무음/잡음 → "에이원코리아입니다", 고유명사 목록 전체, "This is a clean audio.", "Thank you."
 */
function finalizeText(
  text: string,
  model: string,
  prompt: string,
  logprobs?: number[],
): TranscriptionResult {
  const trimmed = (text ?? "").trim();
  if (trimmed && looksLikeHallucination(trimmed, vocabularyHints(), prompt)) {
    return { text: "", model, silenced: "hallucination", confidence: confidenceOf(logprobs) };
  }
  return { text: trimmed, model, confidence: confidenceOf(logprobs) };
}

/** 토큰 확신도 요약 (없으면 undefined). */
function confidenceOf(logprobs?: number[]): { avg: number; min: number } | undefined {
  if (!logprobs || logprobs.length === 0) {
    return undefined;
  }
  const sum = logprobs.reduce((a, b) => a + b, 0);
  return {
    avg: Number((sum / logprobs.length).toFixed(3)),
    min: Number(Math.min(...logprobs).toFixed(3)),
  };
}

export async function transcribeAudio(
  file: File,
  opts: { mode: "order" | "call_summary" | "sales" },
): Promise<TranscriptionResult> {
  const { file: normalized } = normalizeAudioFile(file);

  if (mockAiEnabled()) {
    return {
      text:
        opts.mode === "order"
          ? "(모의 변환) 문지용 사장님, 내일 오전까지 거래처 에이원코리아 견적서 수정본 보내고, 급하면 카톡으로도 알려줘."
          : opts.mode === "sales"
            ? "(모의 변환) 삼성화재 건설기계 지게차 한 대 신규 견적 부탁드립니다. 차량번호 004가1234이고 가입금액은 5억, 다음 달 1일부터 1년입니다. 고객은 다온기계입니다."
            : "(모의 변환) 안녕하세요 에이원코리아입니다. 아 네 대표님, 저 보험설계사 김민수라고 합니다. 다음 주 화요일 오후 2시에 상담 가능하실까요? 네 그럼 화요일 2시로 잡아주시고, 견적서는 금요일까지 메일로 보내주세요. 네 감사합니다.",
      model: "mock",
      mocked: true,
    };
  }

  const c = appConfig();
  // v1.9: 자연스러운 한국어 업무 문맥 문장을 힌트로 준다(짧은 용어 목록 포함).
  //  - 문장형이라 적응이 좋고, 목록이 문장이 아니어서 생기던 '목록 에코'가 줄어든다.
  //  - 환각은 audio-guard 의 에너지 게이트 + 글 단계 필터가 막는다.
  const prompt = transcriptionPrompt();

  type Attempt = { text: string; logprobs?: number[] };

  const attempt = async (model: string, withLogprobs: boolean): Promise<Attempt> => {
    const params: Record<string, unknown> = {
      file: normalized,
      model,
      language: "ko",
      prompt,
    };
    // whisper-1만 temperature를 지원합니다.
    if (model === "whisper-1") {
      params.temperature = 0;
    } else if (withLogprobs) {
      // v1.9: 토큰별 확신도(logprob). 잡음·숨소리에서 모델이 문장을 '지어낼' 때 값이 크게 낮아진다.
      params.response_format = "json";
      params.include = ["logprobs"];
    }
    const res = await openai().audio.transcriptions.create(
      params as unknown as Parameters<OpenAI["audio"]["transcriptions"]["create"]>[0],
    );
    const text = (res as { text?: string }).text ?? "";
    const raw = (res as { logprobs?: Array<{ logprob?: number }> }).logprobs;
    const logprobs = Array.isArray(raw)
      ? raw.map((p) => Number(p?.logprob)).filter((n) => Number.isFinite(n))
      : undefined;
    return { text, logprobs };
  };

  // 확신도(logprobs)를 못 받는 환경·모델이면 그것만 빼고 같은 모델로 한 번 더 시도한다.
  const attemptSafely = async (model: string): Promise<Attempt & { model: string }> => {
    if (model === "whisper-1") {
      return { ...(await attempt(model, false)), model };
    }
    try {
      return { ...(await attempt(model, true)), model };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/logprob|include/i.test(message)) {
        return { ...(await attempt(model, false)), model };
      }
      throw err;
    }
  };

  try {
    const first = await attemptSafely(c.transcribeModel);
    return finalizeText(first.text, first.model, prompt, first.logprobs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 모델 접근 권한이 없거나 이름이 바뀐 경우 whisper-1로 한 번 더 시도합니다.
    if (c.transcribeModel !== "whisper-1" && /model|not found|does not exist|invalid|unsupported/i.test(message)) {
      const second = await attemptSafely("whisper-1");
      return finalizeText(second.text, second.model, prompt, second.logprobs);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* 구조화(정리)                                                         */
/* ------------------------------------------------------------------ */

const ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignee", "title", "details", "due_date", "priority"],
  properties: {
    assignee: { type: "string", description: "담당자 이름. 지시문에 없으면 '미지정'" },
    title: { type: "string", description: "업무 제목, 25자 이내" },
    details: { type: "string", description: "상세 내용 2~4문장" },
    due_date: { type: "string", description: "기한 YYYY-MM-DD, 없으면 빈 문자열" },
    priority: { type: "string", enum: PRIORITIES },
  },
} as const;

const CALL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["customer_name", "key_requests", "promises", "due_date", "next_actions", "summary"],
  properties: {
    customer_name: { type: "string", description: "고객 성함. 모르면 '미확인'" },
    key_requests: { type: "array", items: { type: "string" } },
    promises: { type: "array", items: { type: "string" } },
    due_date: { type: "string", description: "약속한 기한 YYYY-MM-DD, 없으면 빈 문자열" },
    next_actions: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "3줄 이내 요약" },
  },
} as const;

function orderSystemPrompt(team: string[] = defaultTeamMembers()): string {
  return [
    "너는 에이원코리아(A1)의 업무 지시 정리 비서다.",
    "대표나 직원이 구어체로 말한 업무 지시를 받아 실제로 실행 가능한 업무 지시서로 정리한다.",
    "",
    "규칙:",
    "1. assignee(담당자)는 지시문에 나온 이름을 그대로 쓴다. 이름이 없으면 '미지정'.",
    `2. 회사 직원 목록: ${team.join(", ")}. 발음을 고려해 가장 가까운 이름으로 맞춘다.`,
    "3. title은 누가 봐도 알 수 있는 명사형 25자 이내. 예: '에이원코리아 견적서 수정본 발송'.",
    "4. details는 무엇을 언제까지 누구에게 어떻게 하는지, 원문의 정보를 빠뜨리지 않고 2~4문장으로 쓴다.",
    `5. 오늘 날짜는 ${todayInSeoul()} (Asia/Seoul)이다. '오늘/내일/모레/금요일/다음 주 화요일/이번 주말' 같은 표현은 실제 날짜로 계산해 due_date에 YYYY-MM-DD로 넣는다. 시간만 있으면 해당 날짜를 함께 계산한다. 기한 언급이 없으면 빈 문자열.`,
    "6. priority는 '긴급/높음/보통/낮음' 중 하나. '급해/바로/당장/오늘까지'는 긴급, '중요/꼭'은 높음.",
    "7. 원문에 없는 내용을 지어내지 않는다. 불명확하면 '확인 필요'라고 적는다.",
  ].join("\n");
}

function callSystemPrompt(): string {
  return [
    "너는 통화 녹취를 정리하는 업무 비서다.",
    "통화에는 보통 두 사람(우리 회사 담당자와 고객)이 나온다. 화자를 구분하고 잡담·인사·추임새·중복을 제거해 업무에 필요한 핵심만 남긴다.",
    "",
    "규칙:",
    "1. customer_name은 고객 성함. 성함이 나오지 않으면 '미확인'.",
    "2. key_requests는 고객이 요청한 것을 한 문장씩 배열로. 요청이 없으면 빈 배열.",
    "3. promises는 우리 쪽이 약속한 것(보내기로 한 자료, 잡아준 일정, 연락 등)을 한 문장씩 배열.",
    "4. next_actions는 실제로 해야 할 일을 동사형으로 배열. 담당자가 있으면 앞에 붙인다. 예: '문지용: 견적서 금요일까지 메일 발송'.",
    `5. 오늘 날짜는 ${todayInSeoul()} (Asia/Seoul)이다. '다음 주 화요일', '금요일까지' 같은 표현을 실제 날짜 YYYY-MM-DD로 계산해 due_date에 넣는다. 여러 기한이 있으면 가장 이른 기한. 없으면 빈 문자열.`,
    "6. summary는 3줄 이내, 누구와 무슨 일을 어떻게 마무리했는지.",
    "7. 원문에 없는 내용을 지어내지 않는다.",
  ].join("\n");
}

function cleanPriority(value: unknown): Priority {
  const v = String(value ?? "").trim();
  return (PRIORITIES as string[]).includes(v) ? (v as Priority) : "보통";
}

function normalizeDate(value: unknown): string {
  const v = String(value ?? "").trim();
  const m = v.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  const s = String(value ?? "").trim();
  return s ? s.split(/\n|;\s*/).map((v) => v.trim()).filter(Boolean) : [];
}

export function parseJsonLoose(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(content.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function chatJson(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<unknown> {
  const c = appConfig();
  const client = openai();

  const responseFormat = (withSchema: boolean) =>
    (withSchema
      ? {
          type: "json_schema" as const,
          json_schema: { name: schemaName, strict: true, schema },
        }
      : { type: "json_object" as const });

  const call = async (withSchema: boolean) =>
    client.chat.completions.create({
      model: c.chatModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: responseFormat(withSchema) as unknown as { type: "json_object" },
    });

  let res;
  try {
    res = await call(true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/response_format|json_schema|unsupported|invalid/i.test(message)) {
      res = await call(false);
    } else {
      throw err;
    }
  }

  const content = res.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonLoose(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.");
  }
  return parsed;
}

export async function structureOrder(transcript: string, sender: string, team?: string[]): Promise<OrderResult> {
  const raw = transcript.trim();
  const members = team && team.length > 0 ? team : defaultTeamMembers();
  if (mockAiEnabled()) {
    const named = members.find((name) => raw.includes(name));
    const firstClause = (raw.split(/[.。\n]/)[0] ?? raw).trim();
    return {
      assignee: named ?? "미지정",
      title: firstClause.slice(0, 25) || "모의 업무",
      details: raw,
      due_date: todayInSeoul(),
      priority: /급|바로|당장|오늘/.test(raw) ? "긴급" : "보통",
      raw_transcript: raw,
    };
  }

  const parsed = (await chatJson(
    orderSystemPrompt(members),
    `지시자: ${sender}\n오늘: ${todayInSeoul()}\n\n[음성 원문]\n${raw}`,
    "work_order",
    ORDER_SCHEMA,
  )) as Record<string, unknown>;

  return {
    assignee: String(parsed.assignee ?? "미지정").trim() || "미지정",
    title: String(parsed.title ?? "").trim() || raw.slice(0, 25),
    details: String(parsed.details ?? "").trim() || raw,
    due_date: normalizeDate(parsed.due_date),
    priority: cleanPriority(parsed.priority),
    raw_transcript: raw,
  };
}

export async function structureCallSummary(transcript: string): Promise<CallSummaryResult> {
  const raw = transcript.trim();
  if (mockAiEnabled()) {
    const sentences = raw
      .split(/(?<=[.!?。])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      customer_name: "미확인 (모의)",
      key_requests: sentences.slice(0, 2),
      promises: [],
      due_date: todayInSeoul(),
      next_actions: [`담당자: ${sentences[0]?.slice(0, 40) ?? "통화 내용 확인"} 확인`],
      summary: sentences.slice(0, 3).join(" ") || raw.slice(0, 160),
      raw_transcript: raw,
    };
  }

  const parsed = (await chatJson(
    callSystemPrompt(),
    `오늘: ${todayInSeoul()}\n\n[통화 녹취 원문]\n${raw}`,
    "call_summary",
    CALL_SCHEMA,
  )) as Record<string, unknown>;

  return {
    customer_name: String(parsed.customer_name ?? "미확인").trim() || "미확인",
    key_requests: asStringArray(parsed.key_requests),
    promises: asStringArray(parsed.promises),
    due_date: normalizeDate(parsed.due_date),
    next_actions: asStringArray(parsed.next_actions),
    summary: String(parsed.summary ?? "").trim() || raw.slice(0, 200),
    raw_transcript: raw,
  };
}

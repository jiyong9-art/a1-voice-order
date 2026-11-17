export type Mode = "order" | "call_summary";

export type Priority = "긴급" | "높음" | "보통" | "낮음";

export const PRIORITIES: Priority[] = ["긴급", "높음", "보통", "낮음"];

/** 모드 A: 음성 업무 오더 정리 결과 */
export interface OrderResult {
  /** 담당자 이름 (직원목록의 '이름'과 일치하도록) */
  assignee: string;
  /** 업무 제목 (짧게) */
  title: string;
  /** 상세 내용 (지시 원문의 요점을 빠짐없이) */
  details: string;
  /** 기한 YYYY-MM-DD, 없으면 "" */
  due_date: string;
  /** 긴급도 */
  priority: Priority;
  /** 음성 원문 */
  raw_transcript: string;
}

/** 모드 B: 통화 녹음 핵심 요약 결과 */
export interface CallSummaryResult {
  /** 고객명 (모르면 "미확인") */
  customer_name: string;
  /** 고객이 요청한 핵심 사항들 */
  key_requests: string[];
  /** 우리가 약속한 내용들 */
  promises: string[];
  /** 약속한 기한 YYYY-MM-DD, 없으면 "" */
  due_date: string;
  /** 다음 할 일 */
  next_actions: string[];
  /** 3줄 이내 요약 */
  summary: string;
  /** 음성 원문 */
  raw_transcript: string;
}

/* ------------------------------------------------------------------ */
/* 영업 오더 초안 (Sales 앱 ← /api/sales/voice)                          */
/* ------------------------------------------------------------------ */

export const SALES_INTENTS = ["견적", "계약", "배서", "해지", "사고접수"] as const;
export type SalesIntent = (typeof SALES_INTENTS)[number];

export interface SalesCustomer {
  name: string;
  /** 사업자등록번호 (예: 123-45-67890) */
  biz_no: string;
  phone: string;
  address: string;
  ceo_name: string;
  /** 서류에서 읽은 경우: 사업자등록증 | 차량등록증 | 신분증 | "" */
  doc_type: string;
}

export interface SalesBasis {
  /** 건설기계 등록번호 */
  car_no: string;
  /** 기종 (지게차·굴착기 등) */
  kind: string;
  /** 가입금액(만원) */
  amount_man: string;
  /** 건물 구조 */
  structure: string;
  /** 적하 인보이스 금액(USD) */
  usd: string;
  /** 적하 출발지 */
  from: string;
  /** 적하 도착지 */
  to: string;
  /** 사고일시 YYYY-MM-DD */
  accident_date: string;
  accident_place: string;
  accident_desc: string;
  free_text: string;
}

export interface SalesOrderDraft {
  intent: SalesIntent;
  customer: SalesCustomer;
  /** 보험 상품명 (자동차·화재·배상·건설기계·근재·적하·기타) */
  product: string;
  /** 보험사명 (자유 텍스트) */
  insurer: string;
  /** 구분 (신규·갱신·배서·해지·사고 등) */
  gu: string;
  /** 목적물/차량번호/현장 */
  obj: string;
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD */
  end_date: string;
  short_term: boolean;
  basis: SalesBasis;
  memo: string;
  /** 빠진 필수 산출기초 항목명 (예: ["차량번호", "보험기간"]) */
  missing: string[];
}

export interface SalesVoiceResponse {
  ok: boolean;
  /** 전사/입력 원문(이미지면 읽은 핵심 요약) */
  transcript: string;
  draft?: SalesOrderDraft;
  /** 가린 개인정보 등 안내 */
  warnings?: string[];
  engine?: { stt: string; model: string; mocked?: boolean };
  error?: string;
}

export interface SessionUser {
  name: string;
  exp: number;
}

export interface SubmitResponse {
  ok: boolean;
  sheet: {
    skipped: boolean;
    reason?: string;
    tab?: string;
    row?: number;
    url?: string;
    /** 작성자 전용 시트에 기록됐는지 */
    target?: "master" | "personal";
  };
  mail: {
    skipped: boolean;
    reason?: string;
    to: string[];
  };
  registeredAt: string;
  error?: string;
}

export function formatKoreanDateTime(value: Date | string = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function todayInSeoul(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export function priorityTone(p: Priority): string {
  switch (p) {
    case "긴급":
      return "bg-red-50 text-red-700 ring-red-200";
    case "높음":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "낮음":
      return "bg-slate-50 text-slate-600 ring-slate-200";
    default:
      return "bg-sky-50 text-sky-700 ring-sky-200";
  }
}

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

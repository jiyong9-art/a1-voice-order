"use client";

/**
 * 내 기기 저장(로컬 저장함) — 브라우저 localStorage에 직원 이름별로 기록을 보관합니다.
 * 서버·구글 시트가 연결되지 않아도 100% 동작하며, 엑셀(CSV, UTF-8 BOM)로 바로 내려받을 수 있습니다.
 */

import type { CallSummaryResult, Mode, OrderResult } from "./types";
import { formatKoreanDateTime } from "./types";

export type SavedPayload = OrderResult | CallSummaryResult;

export interface LocalRecord {
  /** 고유 ID */
  id: string;
  /** 업무오더인지 통화요약인지 */
  mode: Mode;
  /** 저장 시각 ISO */
  savedAt: string;
  /** 저장 시각 표시용 (예: 2026-11-17 23:40) */
  savedAtLabel: string;
  /** 카드에서 확정한 내용 */
  data: SavedPayload;
}

const PREFIX = "a1.orderbook.v1";
/** 한 직원당 보관 최대 건수 (localStorage 용량 보호) */
const MAX_RECORDS = 500;

function storageKey(owner: string): string {
  return `${PREFIX}::${owner.trim() || "미지정"}`;
}

function available(): boolean {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

export function loadRecords(owner: string): LocalRecord[] {
  if (!available()) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(owner));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LocalRecord => {
      const record = item as LocalRecord;
      return Boolean(record && typeof record.id === "string" && record.data && (record.mode === "order" || record.mode === "call_summary"));
    });
  } catch {
    return [];
  }
}

function writeRecords(owner: string, records: LocalRecord[]): void {
  if (!available()) return;
  const trimmed = records.slice(0, MAX_RECORDS);
  try {
    window.localStorage.setItem(storageKey(owner), JSON.stringify(trimmed));
  } catch {
    // 용량 초과 등 — 오래된 기록을 절반으로 줄여 한 번 더 시도합니다.
    try {
      window.localStorage.setItem(storageKey(owner), JSON.stringify(trimmed.slice(0, Math.max(10, Math.floor(trimmed.length / 2)))));
    } catch {
      /* 저장 실패는 조용히 무시 (화면에서 안내) */
    }
  }
}

export function countRecords(owner: string): number {
  return loadRecords(owner).length;
}

export function makeRecord(mode: Mode, data: SavedPayload): LocalRecord {
  const now = new Date();
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    savedAt: now.toISOString(),
    savedAtLabel: formatKoreanDateTime(now),
    data,
  };
}

/** 새 기록을 맨 앞에 추가하고, 추가 후 전체 목록을 돌려줍니다. */
export function appendRecord(owner: string, record: LocalRecord): LocalRecord[] {
  const next = [record, ...loadRecords(owner)];
  writeRecords(owner, next);
  return next;
}

export function removeRecord(owner: string, id: string): LocalRecord[] {
  const next = loadRecords(owner).filter((record) => record.id !== id);
  writeRecords(owner, next);
  return next;
}

export function clearRecords(owner: string): void {
  if (!available()) return;
  try {
    window.localStorage.removeItem(storageKey(owner));
  } catch {
    /* 무시 */
  }
}

/** 목록에 보여 줄 한 줄 제목 */
export function recordTitle(record: LocalRecord): string {
  if (record.mode === "order") {
    const order = record.data as OrderResult;
    return order.title || "(제목 없음)";
  }
  const summary = record.data as CallSummaryResult;
  return summary.summary?.split("\n")[0]?.trim() || `${summary.customer_name} 통화요약`;
}

/** 목록에 보여 줄 보조 정보 */
export function recordMeta(record: LocalRecord): string {
  if (record.mode === "order") {
    const order = record.data as OrderResult;
    return [order.assignee, order.priority, order.due_date ? `기한 ${order.due_date}` : ""].filter(Boolean).join(" · ");
  }
  const summary = record.data as CallSummaryResult;
  return [summary.customer_name, summary.due_date ? `기한 ${summary.due_date}` : ""].filter(Boolean).join(" · ");
}

const CSV_HEADER = [
  "구분",
  "등록일시",
  "담당자",
  "고객명",
  "업무제목",
  "요약",
  "상세내용",
  "핵심요청",
  "약속사항",
  "다음할일",
  "기한",
  "긴급도",
  "음성원문",
];

/** 엑셀에서 한 칸에 깔끔히 보이도록 줄바꿈은 한 줄로 폅니다. */
function cell(value: unknown): string {
  const text = String(value ?? "")
    .replace(/\r\n|\r|\n/g, " / ")
    .replace(/\t/g, " ")
    .trim();
  if (/[",]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function listCell(list: unknown): string {
  if (Array.isArray(list)) return list.map((v) => String(v ?? "").trim()).filter(Boolean).join(" / ");
  return "";
}

export function recordsToCsv(records: LocalRecord[]): string {
  const rows: string[][] = [];
  for (const record of records) {
    if (record.mode === "order") {
      const order = record.data as OrderResult;
      rows.push([
        "업무오더",
        record.savedAtLabel,
        order.assignee,
        "",
        order.title,
        "",
        order.details,
        "",
        "",
        "",
        order.due_date,
        order.priority,
        order.raw_transcript,
      ]);
    } else {
      const summary = record.data as CallSummaryResult;
      rows.push([
        "통화요약",
        record.savedAtLabel,
        "",
        summary.customer_name,
        "",
        summary.summary,
        "",
        listCell(summary.key_requests),
        listCell(summary.promises),
        listCell(summary.next_actions),
        summary.due_date,
        "",
        summary.raw_transcript,
      ]);
    }
  }
  const lines = [CSV_HEADER.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))];
  // 줄바꿈은 CRLF — 엑셀·구글 스프레드시트 모두 잘 읽습니다.
  return `${lines.join("\r\n")}\r\n`;
}

function stamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}`;
}

export function csvFileName(owner: string, scope: Mode | "all"): string {
  const label = scope === "all" ? "전체" : scope === "order" ? "업무오더" : "통화요약";
  return `A1_내기기저장_${owner.trim() || "직원"}_${label}_${stamp()}.csv`;
}

/** CSV 파일을 즉시 다운로드합니다. (UTF-8 BOM 포함 → 엑셀 한글 깨짐 없음) */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined") return;
  // ﻿(UTF-8 BOM)을 맨 앞에 붙여야 엑셀에서 한글이 깨지지 않습니다.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

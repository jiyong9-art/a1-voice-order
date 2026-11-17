"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CallSummaryResult, Mode, OrderResult } from "@/lib/types";
import {
  clearRecords,
  csvFileName,
  downloadCsv,
  loadRecords,
  recordMeta,
  recordTitle,
  recordsToCsv,
  removeRecord,
  type LocalRecord,
} from "@/lib/local-store";
import { AlertIcon, ChevronDownIcon, CloseIcon, DownloadIcon, FolderIcon, TrashIcon } from "./icons";

type Filter = Mode | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "order", label: "업무오더" },
  { key: "call_summary", label: "통화요약" },
];

function DetailLines({ record }: { record: LocalRecord }) {
  if (record.mode === "order") {
    const order = record.data as OrderResult;
    return (
      <div className="space-y-1.5 text-[12px] leading-5 text-slate-600">
        <p>
          <span className="font-semibold text-slate-500">담당자</span> {order.assignee || "-"} ·{" "}
          <span className="font-semibold text-slate-500">긴급도</span> {order.priority}
        </p>
        <p>
          <span className="font-semibold text-slate-500">기한</span> {order.due_date || "-"}
        </p>
        <p className="whitespace-pre-wrap break-words">
          <span className="font-semibold text-slate-500">상세</span> {order.details || "-"}
        </p>
        {order.raw_transcript && (
          <p className="whitespace-pre-wrap break-words text-slate-400">
            <span className="font-semibold">음성원문</span> {order.raw_transcript}
          </p>
        )}
      </div>
    );
  }
  const summary = record.data as CallSummaryResult;
  const list = (label: string, items: string[]) =>
    items.length > 0 && (
      <p>
        <span className="font-semibold text-slate-500">{label}</span> {items.join(" / ")}
      </p>
    );
  return (
    <div className="space-y-1.5 text-[12px] leading-5 text-slate-600">
      <p>
        <span className="font-semibold text-slate-500">고객</span> {summary.customer_name || "-"} ·{" "}
        <span className="font-semibold text-slate-500">기한</span> {summary.due_date || "-"}
      </p>
      <p className="whitespace-pre-wrap break-words">
        <span className="font-semibold text-slate-500">요약</span> {summary.summary || "-"}
      </p>
      {list("핵심요청", summary.key_requests)}
      {list("약속사항", summary.promises)}
      {list("다음할일", summary.next_actions)}
    </div>
  );
}

export default function LocalLibrary({
  open,
  owner,
  onClose,
  onChanged,
}: {
  open: boolean;
  owner: string;
  onClose: () => void;
  onChanged?: (count: number) => void;
}) {
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(() => {
    const next = loadRecords(owner);
    setRecords(next);
    onChanged?.(next.length);
  }, [owner, onChanged]);

  useEffect(() => {
    if (!open) {
      setExpanded(null);
      setConfirmClear(false);
      return;
    }
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const visible = useMemo(
    () => (filter === "all" ? records : records.filter((record) => record.mode === filter)),
    [records, filter],
  );

  function download() {
    if (visible.length === 0) return;
    downloadCsv(csvFileName(owner, filter), recordsToCsv(visible));
  }

  function remove(id: string) {
    const next = removeRecord(owner, id);
    setRecords(next);
    onChanged?.(next.length);
    if (expanded === id) setExpanded(null);
  }

  function clearAll() {
    clearRecords(owner);
    setRecords([]);
    onChanged?.(0);
    setConfirmClear(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 sm:items-center sm:p-4 sm:backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="내 기기 저장함"
    >
      <button type="button" aria-label="내 기기 저장함 닫기" onClick={onClose} className="absolute inset-0 cursor-default" />

      <div className="relative z-10 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
            <FolderIcon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-bold leading-5 text-slate-900">내 기기 저장함</h2>
            <p className="truncate text-[11px] leading-4 text-slate-400">
              {owner} 님 · 이 브라우저에 저장된 기록 {records.length}건
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:scale-95"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5">
          {FILTERS.map((item) => {
            const count =
              item.key === "all" ? records.length : records.filter((record) => record.mode === item.key).length;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition ${
                  filter === item.key ? "bg-brand text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {item.label} {count}
              </button>
            );
          })}
          <button
            type="button"
            onClick={download}
            disabled={visible.length === 0}
            className="ml-auto flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200 disabled:opacity-50"
          >
            <DownloadIcon className="h-3.5 w-3.5" /> 엑셀(CSV)
          </button>
        </div>

        <div className="a1-scroll flex-1 overflow-y-auto px-4 py-3">
          {visible.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 px-3 py-6 text-center text-[12px] leading-5 text-slate-500">
              저장된 기록이 없습니다.
              <br />
              카드에서 <b>내 기기에 저장</b>을 누르면 여기에 쌓입니다.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((record) => {
                const isOpen = expanded === record.id;
                return (
                  <li key={record.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-start gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : record.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              record.mode === "order" ? "bg-brand-light text-brand" : "bg-sky-50 text-sky-700"
                            }`}
                          >
                            {record.mode === "order" ? "업무오더" : "통화요약"}
                          </span>
                          <span className="truncate text-[13px] font-semibold text-slate-800">{recordTitle(record)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                          {record.savedAtLabel} · {recordMeta(record)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(record.id)}
                        aria-label="이 기록 삭제"
                        className="shrink-0 rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : record.id)}
                        aria-label={isOpen ? "접기" : "펼치기"}
                        className={`shrink-0 rounded-full p-1.5 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`}
                      >
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2">
                        <DetailLines record={record} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-2.5">
          {confirmClear ? (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2">
              <AlertIcon className="h-3.5 w-3.5 shrink-0 text-red-500" />
              <span className="text-[11.5px] font-medium text-red-600">이 기기의 기록을 모두 지울까요?</span>
              <button
                type="button"
                onClick={clearAll}
                className="ml-auto rounded-full bg-red-500 px-2.5 py-1 text-[11.5px] font-semibold text-white"
              >
                모두 삭제
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-full bg-white px-2 py-1 text-[11.5px] font-medium text-slate-500 ring-1 ring-slate-200"
              >
                취소
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10.5px] leading-4 text-slate-400">
                이 브라우저에만 보관됩니다 · CSV는 엑셀에서 바로 열립니다
              </p>
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={records.length === 0}
                className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-slate-400 underline decoration-dotted underline-offset-2 disabled:opacity-40"
              >
                전체 삭제
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

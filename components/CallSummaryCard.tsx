"use client";

import { useState } from "react";
import type { CallSummaryResult } from "@/lib/types";
import { AlertIcon, CheckIcon, CopyIcon, MailIcon, SheetIcon, Spinner } from "./icons";
import { DoneState, type SubmitState } from "./OrderCard";

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[14px] leading-6 text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50";

function toLines(list: string[]): string {
  return list.join("\n");
}
function fromLines(text: string): string[] {
  return text
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

export default function CallSummaryCard({
  data,
  submit,
  onSubmit,
}: {
  data: CallSummaryResult;
  submit: SubmitState;
  onSubmit: (summary: CallSummaryResult) => void;
}) {
  const [form, setForm] = useState<CallSummaryResult>(data);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const locked = submit.phase === "submitting" || submit.phase === "done";

  const update = (patch: Partial<CallSummaryResult>) => setForm((prev) => ({ ...prev, ...patch }));

  async function copySummary() {
    const text = [
      `[통화요약] ${form.customer_name}`,
      `요약: ${form.summary}`,
      `핵심요청: ${form.key_requests.map((v, i) => `${i + 1}) ${v}`).join(" ")}`,
      `약속사항: ${form.promises.map((v, i) => `${i + 1}) ${v}`).join(" ")}`,
      `기한: ${form.due_date || "-"}`,
      `다음할일: ${form.next_actions.map((v) => `- ${v}`).join(" ")}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 클립보드 미지원 무시 */
    }
  }

  return (
    <div className="a1-fade-up overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_8px_28px_-18px_rgba(15,23,42,0.35)]">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-teal-50/80 to-white px-4 py-2.5">
        <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-white">통화 요약</span>
        <span className="truncate text-[12.5px] font-semibold text-slate-600">{form.customer_name} 고객</span>
        <button
          type="button"
          onClick={copySummary}
          className="ml-auto flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10.5px] font-medium text-slate-500 ring-1 ring-slate-200"
        >
          <CopyIcon className="h-3 w-3" />
          {copied ? "복사됨" : "복사"}
        </button>
      </div>

      <div className="space-y-2.5 px-4 py-3.5">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">고객명</label>
            <input
              value={form.customer_name}
              disabled={locked}
              onChange={(e) => update({ customer_name: e.target.value })}
              className={`${fieldClass} font-semibold`}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">기한</label>
            <input
              type="date"
              value={form.due_date}
              disabled={locked}
              onChange={(e) => update({ due_date: e.target.value })}
              className={fieldClass}
            />
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-bold text-slate-500">3줄 요약</p>
          <textarea
            value={form.summary}
            disabled={locked}
            rows={3}
            onChange={(e) => update({ summary: e.target.value })}
            className="mt-1 w-full resize-none bg-transparent text-[13.5px] leading-6 text-slate-800 outline-none disabled:opacity-70"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">고객 핵심 요청 (한 줄에 하나)</label>
          <textarea
            value={toLines(form.key_requests)}
            disabled={locked}
            rows={Math.max(2, form.key_requests.length)}
            onChange={(e) => update({ key_requests: fromLines(e.target.value) })}
            className={`${fieldClass} resize-y disabled:opacity-70`}
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">우리가 약속한 것 (한 줄에 하나)</label>
          <textarea
            value={toLines(form.promises)}
            disabled={locked}
            rows={Math.max(2, form.promises.length)}
            onChange={(e) => update({ promises: fromLines(e.target.value) })}
            className={`${fieldClass} resize-y disabled:opacity-70`}
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">다음 할 일 (한 줄에 하나)</label>
          <textarea
            value={toLines(form.next_actions)}
            disabled={locked}
            rows={Math.max(2, form.next_actions.length)}
            onChange={(e) => update({ next_actions: fromLines(e.target.value) })}
            className={`${fieldClass} resize-y disabled:opacity-70`}
          />
        </div>

        {form.raw_transcript && (
          <div>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="text-[11.5px] font-medium text-slate-400 underline decoration-dotted underline-offset-2"
            >
              {showRaw ? "녹취 원문 숨기기" : "녹취 원문 보기"}
            </button>
            {showRaw && (
              <p className="mt-1.5 max-h-40 overflow-y-auto rounded-xl bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-500">
                {form.raw_transcript}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        {submit.phase === "done" && submit.result ? (
          <DoneState result={submit.result} />
        ) : (
          <>
            {submit.error && (
              <p className="mb-2 flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-600">
                <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {submit.error}
              </p>
            )}
            <button
              type="button"
              onClick={() => onSubmit(form)}
              disabled={submit.phase === "submitting"}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 py-3 text-[14.5px] font-semibold text-white shadow-md shadow-teal-200 transition active:scale-[0.99] disabled:opacity-60"
            >
              {submit.phase === "submitting" ? (
                <>
                  <Spinner className="h-4 w-4" /> 시트에 기록하는 중…
                </>
              ) : (
                <>
                  <SheetIcon className="h-4 w-4" /> 통화요약 시트에 등록
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { OrderResult, Priority, SubmitResponse } from "@/lib/types";
import { PRIORITIES, priorityTone } from "@/lib/types";
import { AlertIcon, CheckIcon, MailIcon, SheetIcon, Spinner } from "./icons";

export type SubmitState = {
  phase: "draft" | "submitting" | "done" | "error";
  result?: SubmitResponse;
  error?: string;
};

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[14px] leading-6 text-slate-800 outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand-border/60";

export default function OrderCard({
  data,
  submit,
  onSubmit,
}: {
  data: OrderResult;
  submit: SubmitState;
  onSubmit: (order: OrderResult) => void;
}) {
  const [form, setForm] = useState<OrderResult>(data);
  const [showRaw, setShowRaw] = useState(false);
  const locked = submit.phase === "submitting" || submit.phase === "done";

  const update = (patch: Partial<OrderResult>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="a1-fade-up overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_8px_28px_-18px_rgba(15,23,42,0.35)]">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-light/80 to-white px-4 py-2.5">
        <span className="rounded-full bg-brand px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-white">업무 오더</span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ${priorityTone(form.priority)}`}>
          {form.priority}
        </span>
        <span className="ml-auto text-[10.5px] text-slate-400">AI 정리 결과</span>
      </div>

      <div className="space-y-2.5 px-4 py-3.5">
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">업무 제목</label>
          <input
            value={form.title}
            disabled={locked}
            onChange={(e) => update({ title: e.target.value })}
            className={`${fieldClass} font-semibold disabled:opacity-70`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">담당자</label>
            <input
              value={form.assignee}
              disabled={locked}
              onChange={(e) => update({ assignee: e.target.value })}
              className={fieldClass}
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

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">긴급도</label>
          <div className="flex gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                disabled={locked}
                onClick={() => update({ priority: p as Priority })}
                className={`flex-1 rounded-xl px-2 py-1.5 text-[12.5px] font-semibold ring-1 transition ${
                  form.priority === p ? priorityTone(p) : "bg-white text-slate-400 ring-slate-200"
                } disabled:opacity-60`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">상세 내용</label>
          <textarea
            value={form.details}
            disabled={locked}
            rows={4}
            onChange={(e) => update({ details: e.target.value })}
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
              {showRaw ? "음성 원문 숨기기" : "음성 원문 보기"}
            </button>
            {showRaw && (
              <p className="mt-1.5 max-h-32 overflow-y-auto rounded-xl bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-500">
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
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-md shadow-brand/25 transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
            >
              {submit.phase === "submitting" ? (
                <>
                  <Spinner className="h-4 w-4" /> 시트에 기록하는 중…
                </>
              ) : (
                <>
                  <SheetIcon className="h-4 w-4" /> 시트에 등록하고 담당자에게 알림
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function DoneState({ result }: { result: SubmitResponse }) {
  const sheetSkipped = result.sheet.skipped;
  const mailSkipped = result.mail.skipped;
  return (
    <div className="space-y-2">
      <div
        className={`flex items-start gap-2 rounded-2xl px-3 py-2.5 text-[12.5px] leading-5 ${
          sheetSkipped ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"
        }`}
      >
        {sheetSkipped ? <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0">
          {sheetSkipped ? (
            <>
              <b>시트에 저장되지 않았습니다.</b>
              <br />
              {result.sheet.reason}
            </>
          ) : (
            <>
              <b>
                ‘{result.sheet.tab}’ {result.sheet.target === "personal" ? "내 전용 시트" : "시트"}{" "}
                {result.sheet.row ? `${result.sheet.row}행` : "새 행"}에 기록했습니다.
              </b>
              {result.sheet.url && (
                <a
                  href={result.sheet.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 underline decoration-emerald-300 underline-offset-2"
                >
                  시트 열기
                </a>
              )}
            </>
          )}
        </div>
      </div>

      <div
        className={`flex items-start gap-2 rounded-2xl px-3 py-2.5 text-[12.5px] leading-5 ${
          mailSkipped ? "bg-slate-50 text-slate-500" : "bg-emerald-50/70 text-emerald-700"
        }`}
      >
        <MailIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          {mailSkipped ? (
            <>메일 알림은 건너뛰었습니다. {result.mail.reason}</>
          ) : (
            <>담당자에게 알림 메일을 보냈습니다. ({result.mail.to.join(", ")})</>
          )}
        </div>
      </div>

      <p className="text-right text-[10.5px] text-slate-400">등록일시 {result.registeredAt}</p>
    </div>
  );
}

"use client";

import type { LocalRecord } from "@/lib/local-store";
import { csvFileName, downloadCsv, recordsToCsv } from "@/lib/local-store";
import type { Mode, SubmitResponse } from "@/lib/types";
import { AlertIcon, CheckIcon, DeviceIcon, DownloadIcon, DriveIcon, FolderIcon, SheetIcon, Spinner } from "./icons";

export type SaveTarget = "local" | "drive";

export type LocalSaved = { record: LocalRecord; count: number };

export type SubmitState = {
  phase: "draft" | "submitting" | "done" | "error";
  /** 지금 저장 중이거나 저장이 끝난 방식 */
  target?: SaveTarget;
  /** 구글 드라이브(시트) 저장 결과 */
  result?: SubmitResponse;
  /** 내 기기 저장 결과 */
  local?: LocalSaved;
  error?: string;
};

export const idleSubmit: SubmitState = { phase: "draft" };

/**
 * 카드 하단 저장 버튼 — [내 기기에 저장] / [구글 드라이브 저장]
 * 두 방식을 눈으로 구분할 수 있게 나란히 두고, 드라이브 저장 시에도 기기에 함께 남길 수 있게 했습니다.
 */
export function SaveActions({
  mode,
  target,
  alsoLocal,
  onToggleAlsoLocal,
  onSaveLocal,
  onSaveDrive,
  onOpenLibrary,
  error,
}: {
  mode: Mode;
  /** 저장 중인 방식 (없으면 대기) */
  target?: SaveTarget;
  alsoLocal: boolean;
  onToggleAlsoLocal: (value: boolean) => void;
  onSaveLocal: () => void;
  onSaveDrive: () => void;
  onOpenLibrary?: () => void;
  error?: string;
}) {
  const submitting = Boolean(target);
  const localBusy = target === "local";
  const driveBusy = target === "drive";

  return (
    <div className="space-y-2">
      {error && (
        <p className="flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-600">
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSaveLocal}
          disabled={submitting}
          className="flex flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-2xl border border-brand-border bg-brand-light/70 px-1.5 py-2.5 text-[12.5px] font-semibold text-brand transition hover:bg-brand-border/40 active:scale-[0.99] disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            {localBusy ? <Spinner className="h-4 w-4" /> : <DeviceIcon className="h-4 w-4" />}
            {localBusy ? "저장 중…" : "내 기기에 저장"}
          </span>
          <span className="text-[9.5px] font-medium text-brand/60">이 브라우저에 보관</span>
        </button>

        <button
          type="button"
          onClick={onSaveDrive}
          disabled={submitting}
          className="flex flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-2xl bg-brand px-1.5 py-2.5 text-[12.5px] font-semibold text-white shadow-md shadow-brand/25 transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            {driveBusy ? <Spinner className="h-4 w-4" /> : <DriveIcon className="h-4 w-4" />}
            {driveBusy ? "저장 중…" : "구글 드라이브 저장"}
          </span>
          <span className="text-[9.5px] font-medium text-white/70">직원 시트에 기록</span>
        </button>
      </div>

      <label className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
        <input
          type="checkbox"
          checked={alsoLocal}
          onChange={(event) => onToggleAlsoLocal(event.target.checked)}
          disabled={submitting}
          className="h-3.5 w-3.5 rounded border-slate-300 accent-[#003a84]"
        />
        드라이브에 저장할 때 내 기기에도 함께 저장
      </label>

      <div className="flex items-center justify-center gap-2 text-[10.5px] text-slate-400">
        <span className="flex items-center gap-1">
          <SheetIcon className="h-3 w-3" />
          {mode === "order" ? "업무오더" : "통화요약"} 기록
        </span>
        {onOpenLibrary && (
          <button
            type="button"
            onClick={onOpenLibrary}
            className="flex items-center gap-1 font-semibold text-slate-500 underline decoration-dotted underline-offset-2"
          >
            <FolderIcon className="h-3 w-3" /> 내 기기 저장함
          </button>
        )}
      </div>
    </div>
  );
}

/** ‘내 기기에 저장했습니다’ + CSV 내려받기 — 완료 화면과 재시도 화면에서 함께 사용 */
export function LocalSavedBadge({
  record,
  count,
  mode,
  owner,
  onOpenLibrary,
}: {
  record: LocalRecord;
  count: number;
  mode: Mode;
  owner: string;
  onOpenLibrary?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-[12.5px] leading-5 text-emerald-700">
      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <b>내 기기에 저장했습니다.</b>
        <span className="ml-1 text-emerald-700/80">이 브라우저에 {count}건 보관 중</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => downloadCsv(csvFileName(owner, mode), recordsToCsv([record]))}
            className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
          >
            <DownloadIcon className="h-3.5 w-3.5" /> 엑셀(CSV)로 내려받기
          </button>
          {onOpenLibrary && (
            <button
              type="button"
              onClick={onOpenLibrary}
              className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-600 ring-1 ring-slate-200"
            >
              <FolderIcon className="h-3.5 w-3.5" /> 저장함 열기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 저장이 끝난 뒤의 결과 — 메일 안내 없이 ‘어디에 저장됐는지’만 보여 줍니다. */
export function DoneState({
  state,
  mode,
  owner,
  onOpenLibrary,
  onSaveLocal,
}: {
  state: SubmitState;
  mode: Mode;
  owner: string;
  onOpenLibrary?: () => void;
  /** 드라이브 저장이 건너뛰어졌을 때, 이 카드를 그대로 기기에 남기는 버튼 */
  onSaveLocal?: () => void;
}) {
  const local = state.local;
  const result = state.result;
  const savedAt = local?.record.savedAtLabel ?? result?.registeredAt ?? "";

  return (
    <div className="space-y-2">
      {local && (
        <LocalSavedBadge
          record={local.record}
          count={local.count}
          mode={mode}
          owner={owner}
          onOpenLibrary={onOpenLibrary}
        />
      )}

      {result && (
        <div
          className={`flex items-start gap-2 rounded-2xl px-3 py-2.5 text-[12.5px] leading-5 ${
            result.sheet.skipped ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {result.sheet.skipped ? (
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0">
            {result.sheet.skipped ? (
              <>
                <b>구글 드라이브에 저장되지 않았습니다.</b>
                <br />
                {result.sheet.reason}
                <br />
                {!local && onSaveLocal ? (
                  <button
                    type="button"
                    onClick={onSaveLocal}
                    className="mt-1.5 flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-amber-800 ring-1 ring-amber-200"
                  >
                    <DeviceIcon className="h-3.5 w-3.5" /> 대신 내 기기에 저장
                  </button>
                ) : (
                  <span className="text-amber-700/80">대신 [내 기기에 저장]으로 이 기기에 남길 수 있어요.</span>
                )}
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
      )}

      {savedAt && <p className="text-right text-[10.5px] text-slate-400">등록일시 {savedAt}</p>}
    </div>
  );
}

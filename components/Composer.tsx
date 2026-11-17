"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Mode } from "@/lib/types";
import { AlertIcon, CloseIcon, MicIcon, PaperclipIcon, SendIcon, Spinner, StopIcon } from "./icons";

const MAX_SECONDS = 120;

/** 마이크를 쓸 수 없을 때(PC에 장치 없음·브라우저 권한 차단 등) 보여 줄 안내 */
const MIC_GUIDE =
  "PC에 마이크가 없거나 브라우저 권한이 꺼져 있어요. 아래 입력창에 글로 입력하거나 📎 파일 올리기를 이용해 주세요.";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function extensionFor(type: string): string {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export default function Composer({
  mode,
  value,
  onChange,
  onSend,
  onAudio,
  onError,
  busy,
  focusTick,
}: {
  mode: Mode;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAudio: (file: File) => void;
  onError: (message: string) => void;
  busy: "idle" | "transcribing" | "structuring";
  /** 값이 증가할 때마다 입력창에 커서를 둡니다(음성 변환 결과가 들어온 경우). */
  focusTick: number;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [micHint, setMicHint] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    // 마이크를 쓸 수 없는 환경이면 막연한 오류 대신 무엇을 하면 되는지 분명히 알려 줍니다.
    const unsupported =
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined";
    if (unsupported) {
      setMicHint(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128_000 } : undefined);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0]!;
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (blob.size < 1500) {
          onError("녹음이 너무 짧습니다. 다시 시도해 주세요.");
          return;
        }
        const file = new File([blob], `voice-${Date.now()}.${extensionFor(type)}`, { type });
        onAudio(file);
      };

      recorder.start(250);
      recorderRef.current = recorder;
      streamRef.current = stream;
      setMicHint(false);
      setSeconds(0);
      setRecording(true);
    } catch {
      // 권한 차단(NotAllowedError)·장치 없음(NotFoundError)·MediaRecorder 실패 모두 같은 안내로 모읍니다.
      setMicHint(true);
    }
  }, [onAudio, onError]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stopRecording();
  }, [recording, seconds, stopRecording]);

  useEffect(() => {
    return () => {
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // 변환된 텍스트가 입력창에 들어오면 커서를 끝으로 보냅니다.
  useEffect(() => {
    if (!focusTick) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusTick]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const disabled = busy !== "idle";

  return (
    <div className="border-t border-slate-200/80 bg-white/95 backdrop-blur">
      {micHint && !recording && (
        <div className="mx-auto max-w-md px-3 pt-2.5">
          <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800 ring-1 ring-amber-100">
            <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{MIC_GUIDE}</span>
            <button
              type="button"
              onClick={() => setMicHint(false)}
              aria-label="안내 닫기"
              className="mt-0.5 shrink-0 rounded-full p-0.5 text-amber-500 transition hover:bg-amber-100"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {(recording || disabled) && (
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 pt-2.5">
          {recording ? (
            <div className="flex flex-1 items-center gap-2.5 rounded-full bg-red-50 px-3.5 py-2 text-red-600">
              <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                <span className="a1-ping absolute inset-0 rounded-full bg-red-500/40" />
                <span className="h-2 w-2 rounded-full bg-red-500" />
              </span>
              <span className="text-[12.5px] font-semibold">듣고 있어요 · {mmss}</span>
              <span className="ml-auto flex items-end gap-[3px]">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="a1-bar h-3 w-[3px] rounded-full bg-red-400"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </span>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-2 rounded-full bg-brand-light px-3.5 py-2 text-brand">
              <Spinner className="h-4 w-4" />
              <span className="text-[12.5px] font-semibold">
                {busy === "transcribing" ? "음성을 글자로 옮기는 중…" : "AI가 정리하고 있어요…"}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="pb-safe mx-auto max-w-md px-3 pt-2">
        <div className="flex items-end gap-1.5 rounded-[26px] border border-slate-200 bg-white p-1.5 shadow-[0_6px_24px_-12px_rgba(15,23,42,0.3)]">
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={
              mode === "order"
                ? "말로 지시하거나 여기에 입력하세요"
                : "통화 내용을 붙여넣거나 📎로 녹음 파일을 올리세요"
            }
            className="max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-6 text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => (recording ? stopRecording() : startRecording())}
            disabled={disabled}
            aria-label={recording ? "녹음 중지" : "녹음 시작"}
            className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
              recording ? "bg-red-500 text-white shadow-red-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {recording ? <StopIcon className="h-4.5 w-4.5" /> : <MicIcon className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            aria-label="녹음 파일 올리기"
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 active:scale-95 disabled:opacity-40"
          >
            <PaperclipIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onSend}
            disabled={disabled || (!value.trim() && !recording)}
            aria-label="전송"
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            <SendIcon className="h-5 w-5" />
          </button>
        </div>

        <p className="pb-1 pt-1.5 text-center text-[10.5px] text-slate-400">
          {mode === "order"
            ? "🎤 짧게 말하면 입력창에 글이 올라옵니다 · 확인 후 전송"
            : "📞 통화 녹음(.mp3/.m4a)을 올리면 핵심만 5초 만에 정리합니다"}
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.webm,.aac,.ogg,.amr"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 24 * 1024 * 1024) {
              onError("파일이 24MB를 넘습니다. 통화를 나눠 올려 주세요.");
              return;
            }
            onAudio(file);
          }}
        />
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallSummaryResult, Mode, OrderResult, SubmitResponse } from "@/lib/types";
import logoWide from "@/public/logo-a1-wide.png";
import CallSummaryCard from "./CallSummaryCard";
import Composer from "./Composer";
import OrderCard, { type SubmitState } from "./OrderCard";
import {
  AlertIcon,
  CheckIcon,
  LogoutIcon,
  MicIcon,
  PhoneIcon,
  SparkIcon,
  Spinner,
} from "./icons";

type Message =
  | { id: string; role: "user"; kind: "text"; text: string; at: string }
  | { id: string; role: "assistant"; kind: "info"; text: string; at: string; tone?: "info" | "error" }
  | { id: string; role: "assistant"; kind: "order"; data: OrderResult; submit: SubmitState; at: string }
  | { id: string; role: "assistant"; kind: "call"; data: CallSummaryResult; submit: SubmitState; at: string };

interface AppStatus {
  ai: boolean;
  sheets: boolean;
  mail: boolean;
  mock: boolean;
  hasPasscode: boolean;
  spreadsheetUrl: string | null;
}

const idleSubmit: SubmitState = { phase: "draft" };

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function timeLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return "";
  }
}

const EXAMPLES: Record<Mode, string[]> = {
  order: [
    "내일 오전까지 에이원코리아 견적서 수정본 보내줘",
    "석빈이 생일선물로 무선 이어폰 알아보고 가격 비교해줘",
    "이번 주 금요일까지 블로그 글 2편 예약 발행 확인해줘",
  ],
  call_summary: [
    "📎 통화 녹음 파일을 올려 주세요",
    "통화 내용을 직접 붙여넣어도 요약해 드립니다",
  ],
};

export default function AppShell({
  userName,
  teamMembers,
  status,
}: {
  userName: string;
  teamMembers: string[];
  status: AppStatus;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("order");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "transcribing" | "structuring">("idle");
  const [focusTick, setFocusTick] = useState(0);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn" | "error" } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((text: string, tone: "ok" | "warn" | "error" = "ok") => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    //PWA 바로가기(?mode=call_summary)로 열린 경우 해당 모드로 시작
    const param = new URLSearchParams(window.location.search).get("mode");
    if (param === "call_summary" || param === "order") setMode(param);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // PWA 서비스 워커 등록 (홈 화면 추가 후 오프라인 셸)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 등록 실패는 조용히 무시 */
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, phase]);

  const push = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const info = useCallback(
    (text: string, tone: "info" | "error" = "info") => {
      push({ id: newId(), role: "assistant", kind: "info", text, at: new Date().toISOString(), tone });
    },
    [push],
  );

  const structure = useCallback(
    async (transcript: string, targetMode: Mode) => {
      setPhase("structuring");
      try {
        const res = await fetch("/api/structure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: targetMode, transcript }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          data?: OrderResult | CallSummaryResult;
          error?: string;
        };
        if (!res.ok || !data.ok || !data.data) {
          throw new Error(data.error ?? "AI 정리에 실패했습니다.");
        }
        if (targetMode === "order") {
          push({
            id: newId(),
            role: "assistant",
            kind: "order",
            data: data.data as OrderResult,
            submit: idleSubmit,
            at: new Date().toISOString(),
          });
        } else {
          push({
            id: newId(),
            role: "assistant",
            kind: "call",
            data: data.data as CallSummaryResult,
            submit: idleSubmit,
            at: new Date().toISOString(),
          });
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : "알 수 없는 오류";
        info(text, "error");
        showToast(text, "error");
      } finally {
        setPhase("idle");
      }
    },
    [info, push, showToast],
  );

  const handleAudio = useCallback(
    async (file: File) => {
      if (!file) return;
      setPhase("transcribing");
      try {
        const form = new FormData();
        form.append("audio", file);
        form.append("mode", mode);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });

        if (res.status === 413) {
          throw new Error(
            `파일이 너무 커서 서버가 거절했습니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). ` +
              "Vercel 배포 환경은 요청 본문 4.5MB 제한이 있어 통화를 나눠 올려야 합니다.",
          );
        }

        const data = (await res.json()) as { ok?: boolean; text?: string; error?: string; mocked?: boolean };
        if (!res.ok || !data.ok || !data.text) {
          throw new Error(data.error ?? "음성 변환에 실패했습니다.");
        }

        if (mode === "order") {
          setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${data.text}` : data.text!));
          setFocusTick((t) => t + 1);
          showToast("입력창에 올렸습니다. 확인하고 [전송]을 눌러 주세요.", "ok");
        } else {
          push({ id: newId(), role: "user", kind: "text", text: data.text, at: new Date().toISOString() });
          await structure(data.text, "call_summary");
        }
        if (data.mocked) showToast("모의 모드로 동작 중입니다 (MOCK_AI=true)", "warn");
      } catch (err) {
        let text = err instanceof Error ? err.message : "음성 변환에 실패했습니다.";
        if (/failed to fetch|networkerror|load failed/i.test(text)) {
          text = `업로드에 실패했습니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). 파일이 크면 Vercel 요청 한도(4.5MB)에 걸릴 수 있으니 나눠 올려 주세요.`;
        }
        showToast(text, "error");
        info(text, "error");
      } finally {
        setPhase("idle");
      }
    },
    [info, mode, push, showToast, structure],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || phase !== "idle") return;
    setInput("");
    push({ id: newId(), role: "user", kind: "text", text, at: new Date().toISOString() });
    await structure(text, mode);
  }, [input, mode, phase, push, structure]);

  const submitCard = useCallback(
    async (id: string, targetMode: Mode, data: OrderResult | CallSummaryResult) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && (m.kind === "order" || m.kind === "call") ? { ...m, submit: { phase: "submitting" } } : m,
        ),
      );
      try {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: targetMode, data }),
        });
        const json = (await res.json()) as SubmitResponse & { error?: string };
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "등록에 실패했습니다.");
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id && (m.kind === "order" || m.kind === "call")
              ? { ...m, submit: { phase: "done", result: json } }
              : m,
          ),
        );
        if (json.sheet.skipped) {
          showToast("시트가 연결되지 않아 저장되지 않았습니다.", "warn");
        } else {
          showToast(`${json.sheet.tab} 시트에 등록했습니다.`, "ok");
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : "등록에 실패했습니다.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id && (m.kind === "order" || m.kind === "call")
              ? { ...m, submit: { phase: "error", error: text } }
              : m,
          ),
        );
        showToast(text, "error");
      }
    },
    [showToast],
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const busy = phase !== "idle";
  const warnings: string[] = [];
  if (!status.hasPasscode) warnings.push("팀 비밀번호(APP_PASSCODE)가 설정되지 않았습니다.");
  if (!status.ai) warnings.push(status.mock ? "" : "OPENAI_API_KEY 미설정 — 음성 변환이 동작하지 않습니다.");
  if (!status.sheets) warnings.push("구글 시트 미연결 — 등록해도 저장되지 않습니다.");

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-white/40">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Image
            src={logoWide}
            alt="에이원코리아 A1KOREA"
            priority
            className="h-7 w-auto shrink-0"
          />
          <div className="min-w-0 border-l border-slate-200 pl-2.5">
            <h1 className="truncate text-[13.5px] font-bold leading-4 tracking-tight text-slate-900">
              음성 업무 오더
            </h1>
            <p className="truncate text-[10.5px] leading-4 text-slate-400">시트·메일 자동 정리</p>
          </div>
          <div className="relative ml-auto shrink-0">
            {menuOpen && (
              <button
                type="button"
                aria-label="메뉴 닫기"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-20 cursor-default bg-transparent"
              />
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1.5 pl-2.5 pr-2 text-[12px] font-semibold text-slate-600"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                {userName.slice(0, 1)}
              </span>
              {userName}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-3 py-2 text-[11px] text-slate-400">
                  팀원 {teamMembers.length}명 · {status.mock ? "모의 모드" : status.ai ? "AI 연결됨" : "AI 미연결"}
                </div>
                {status.spreadsheetUrl && (
                  <a
                    href={status.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-3 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    업무오더 시트 열기
                  </a>
                )}
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-[13px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  <LogoutIcon className="h-4 w-4" /> 로그아웃
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-1.5 px-4 pb-2.5">
          {(
            [
              { key: "order" as Mode, label: "음성 오더", icon: MicIcon, hint: "지시 → 업무오더" },
              { key: "call_summary" as Mode, label: "통화 요약", icon: PhoneIcon, hint: "녹음 → 핵심 요약" },
            ] as const
          ).map(({ key, label, icon: Icon }) => {
            const active = mode === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2 text-[13px] font-semibold transition ${
                  active ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200" : "bg-slate-100 text-slate-500"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </header>

      {warnings.filter(Boolean).length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50/80 px-4 py-2">
          <ul className="space-y-0.5">
            {warnings.filter(Boolean).map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-800">
                <AlertIcon className="mt-0.5 h-3 w-3 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <main className="a1-scroll flex-1 overflow-y-auto px-3.5 py-4">
        {messages.length === 0 && phase === "idle" && (
          <div className="mt-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
              <SparkIcon className="h-6 w-6" />
            </div>
            <h2 className="text-[15px] font-bold text-slate-800">{userName}님, 무엇을 시키실까요?</h2>
            <p className="mx-auto mt-1 max-w-[19rem] text-[12.5px] leading-5 text-slate-500">
              {mode === "order"
                ? "마이크를 누르고 편하게 말하세요. 회사 고유명사까지 알아듣고 입력창에 올려 드립니다."
                : "통화 녹음 파일(.mp3/.m4a)을 올리면 화자를 나눠 핵심 요청·약속·다음 할 일만 뽑아 드립니다."}
            </p>

            <div className="mt-5 space-y-2">
              {EXAMPLES[mode].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInput(example.replace("📎 ", ""))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-[12.5px] leading-5 text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((message) => {
            if (message.kind === "text") {
              return (
                <div key={message.id} className="a1-fade-up flex justify-end">
                  <div className="max-w-[85%]">
                    <div className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-indigo-600 px-3.5 py-2.5 text-[14px] leading-6 text-white shadow-sm shadow-indigo-200">
                      {message.text}
                    </div>
                    <p className="mt-1 text-right text-[10px] text-slate-400">{timeLabel(message.at)}</p>
                  </div>
                </div>
              );
            }

            if (message.kind === "info") {
              return (
                <div key={message.id} className="a1-fade-up flex justify-start">
                  <div
                    className={`flex max-w-[85%] items-start gap-2 rounded-3xl rounded-bl-lg px-3.5 py-2.5 text-[12.5px] leading-5 ${
                      message.tone === "error"
                        ? "bg-red-50 text-red-600 ring-1 ring-red-100"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {message.tone === "error" ? (
                      <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <SparkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="whitespace-pre-wrap break-words">{message.text}</span>
                  </div>
                </div>
              );
            }

            if (message.kind === "order") {
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="w-full max-w-[95%]">
                    <OrderCard
                      data={message.data}
                      submit={message.submit}
                      onSubmit={(order) => submitCard(message.id, "order", order)}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="flex justify-start">
                <div className="w-full max-w-[95%]">
                  <CallSummaryCard
                    data={message.data}
                    submit={message.submit}
                    onSubmit={(summary) => submitCard(message.id, "call_summary", summary)}
                  />
                </div>
              </div>
            );
          })}

          {phase === "structuring" && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-3xl rounded-bl-lg bg-slate-100 px-3.5 py-2.5 text-[12.5px] font-medium text-slate-500">
                <Spinner className="h-3.5 w-3.5" /> 업무 지시서로 정리하는 중…
              </div>
            </div>
          )}
          <div ref={bottomRef} className="h-1" />
        </div>
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-30 flex justify-center px-6">
          <div
            className={`a1-fade-up flex max-w-sm items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[12.5px] font-medium shadow-lg ${
              toast.tone === "error"
                ? "bg-red-600 text-white"
                : toast.tone === "warn"
                  ? "bg-amber-500 text-white"
                  : "bg-slate-900/90 text-white"
            }`}
          >
            {toast.tone === "ok" ? <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>{toast.text}</span>
          </div>
        </div>
      )}

      <Composer
        mode={mode}
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onAudio={handleAudio}
        onError={(text) => showToast(text, "error")}
        busy={phase}
        focusTick={focusTick}
      />
    </div>
  );
}

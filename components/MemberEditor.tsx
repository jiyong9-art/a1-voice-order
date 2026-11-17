"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertIcon, CheckIcon, CloseIcon, PlusIcon, Spinner, TrashIcon, UsersIcon } from "./icons";

interface MembersResponse {
  ok?: boolean;
  members?: string[];
  count?: number;
  source?: "apps_script" | "service_account" | "env";
  persistent?: boolean;
  warning?: string;
  verified?: boolean;
  adminRequired?: boolean;
  adminConfigured?: boolean;
  error?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  apps_script: "구글 시트 연동됨",
  service_account: "구글 시트 연동됨",
  env: "기본 명단",
};

export default function MemberEditor({
  open,
  members,
  onClose,
  onMembersChange,
}: {
  open: boolean;
  members: string[];
  onClose: () => void;
  onMembersChange: (members: string[]) => void;
}) {
  const [passcode, setPasscode] = useState("");
  // 직원 추가·삭제는 관리자 전용입니다. 로그인 세션만으로는 열리지 않습니다.
  const [unlocked, setUnlocked] = useState(false);
  const [adminConfigured, setAdminConfigured] = useState<boolean | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<"verify" | "add" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [source, setSource] = useState<string>("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setError("");
      setNotice("");
      setPendingDelete(null);
      return;
    }
    // 닫을 때는 비밀번호와 잠금 해제 상태를 메모리에 남기지 않습니다.
    setPasscode("");
    setNewName("");
    setUnlocked(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (unlocked) {
      const timer = window.setTimeout(() => nameInputRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
  }, [open, unlocked]);

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

  const applyState = useCallback(
    (data: MembersResponse) => {
      if (Array.isArray(data.members)) onMembersChange(data.members);
      if (typeof data.persistent === "boolean") setPersistent(data.persistent);
      if (typeof data.source === "string") setSource(data.source);
      if (typeof data.adminConfigured === "boolean") setAdminConfigured(data.adminConfigured);
      setWarning(data.warning ?? "");
    },
    [onMembersChange],
  );

  const call = useCallback(
    async (method: "POST" | "DELETE", payload: Record<string, unknown>): Promise<{ ok: boolean; data: MembersResponse }> => {
      const res = await fetch("/api/members", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, adminPasscode: passcode }),
      });
      const data = (await res.json().catch(() => ({}))) as MembersResponse;
      return { ok: res.ok && data.ok === true, data };
    },
    [passcode],
  );

  // 모달을 열 때마다 연동 상태(시트/임시)를 다시 확인합니다.
  useEffect(() => {
    if (!open || !unlocked) return;
    let alive = true;
    fetch("/api/members", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: MembersResponse) => {
        if (!alive) return;
        applyState(data);
      })
      .catch(() => {
        /* 상태 확인 실패는 무시 */
      });
    return () => {
      alive = false;
    };
  }, [open, unlocked, applyState]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!passcode.trim()) {
      setError("관리자 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy("verify");
    try {
      const { ok, data } = await call("POST", {});
      if (!ok) {
        setError(data.error ?? "관리자 비밀번호가 맞지 않습니다.");
        return;
      }
      applyState(data);
      setUnlocked(true);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const name = newName.trim();
    setError("");
    setNotice("");
    if (!name) {
      setError("추가할 직원 이름을 입력해 주세요.");
      return;
    }
    setBusy("add");
    try {
      const { ok, data } = await call("POST", { name });
      if (!ok) {
        setError(data.error ?? "직원을 추가하지 못했습니다.");
        if (Array.isArray(data.members)) applyState(data);
        return;
      }
      applyState(data);
      setNewName("");
      setNotice(`${name} 님을 직원 목록에 추가했습니다.`);
      window.setTimeout(() => {
        const list = listRef.current;
        if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
      }, 80);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(target: string) {
    if (busy) return;
    setError("");
    setNotice("");
    setBusy("delete");
    try {
      const { ok, data } = await call("DELETE", { name: target });
      if (!ok) {
        setError(data.error ?? "직원을 삭제하지 못했습니다.");
        if (Array.isArray(data.members)) applyState(data);
        return;
      }
      applyState(data);
      setNotice(`${target} 님을 직원 목록에서 삭제했습니다.`);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
      setPendingDelete(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 sm:items-center sm:p-4 sm:backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="직원 관리"
    >
      <button type="button" aria-label="직원 관리 닫기" onClick={onClose} className="absolute inset-0 cursor-default" />

      <div className="relative z-10 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
            <UsersIcon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-bold leading-5 text-slate-900">직원 관리</h2>
            <p className="truncate text-[11px] leading-4 text-slate-400">
              관리자 비밀번호를 확인한 뒤 추가·삭제할 수 있습니다
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

        {!unlocked ? (
          <form onSubmit={verify} className="px-4 py-5">
            <label htmlFor="member-passcode" className="block text-[12.5px] font-semibold text-slate-700">
              관리자 비밀번호
            </label>
            <input
              id="member-passcode"
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="관리자만 아는 비밀번호"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] tracking-widest outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand-border/60"
            />
            {error && (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy === "verify"}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-md shadow-brand/25 transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
            >
              {busy === "verify" ? (
                <>
                  <Spinner className="h-4 w-4" /> 확인 중…
                </>
              ) : (
                "확인하고 직원 편집"
              )}
            </button>
            <p className="mt-2.5 text-center text-[11px] leading-4 text-slate-400">
              직원 추가·삭제는 <b className="text-slate-500">관리자만</b> 할 수 있습니다.
              {adminConfigured === false && (
                <>
                  <br />
                  (관리자 비밀번호 미설정 — 팀 비밀번호를 사용합니다)
                </>
              )}
            </p>
          </form>
        ) : (
          <>
            <div ref={listRef} className="a1-scroll flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-slate-500">직원 {members.length}명</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-500">
                  {SOURCE_LABEL[source] ?? "목록"}
                </span>
              </div>

              <ul className="space-y-1.5">
                {members.map((member) => (
                  <li
                    key={member}
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-[10.5px] font-bold text-brand">
                      {member.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-slate-800">{member}</span>
                    {pendingDelete === member ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => remove(member)}
                          disabled={busy === "delete"}
                          className="rounded-full bg-red-50 px-2.5 py-1 text-[11.5px] font-semibold text-red-600 disabled:opacity-60"
                        >
                          {busy === "delete" ? "삭제 중…" : "정말 삭제"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                          className="rounded-full bg-slate-100 px-2 py-1 text-[11.5px] font-medium text-slate-500"
                        >
                          취소
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(member)}
                        aria-label={`${member} 삭제`}
                        className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="rounded-2xl bg-slate-50 px-3 py-5 text-center text-[12px] leading-5 text-slate-500">
                    등록된 직원이 없습니다.
                    <br />
                    아래에서 이름을 추가해 주세요.
                  </li>
                )}
              </ul>
            </div>

            <div className="border-t border-slate-100 px-4 pb-safe pt-3">
              <form onSubmit={add} className="flex items-center gap-1.5">
                <input
                  ref={nameInputRef}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="새 직원 이름 (예: 김대리)"
                  maxLength={20}
                  className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[14px] outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand-border/60"
                />
                <button
                  type="submit"
                  disabled={busy !== null}
                  aria-label="직원 추가"
                  className="flex h-[42px] shrink-0 items-center gap-1 rounded-2xl bg-brand px-3.5 text-[13.5px] font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark active:scale-95 disabled:opacity-60"
                >
                  {busy === "add" ? <Spinner className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
                  추가
                </button>
              </form>

              {error && (
                <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-600">
                  <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              )}
              {notice && !error && (
                <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] leading-5 text-emerald-700">
                  <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {notice}
                </p>
              )}
              {(warning || persistent === false) && !error && (
                <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] leading-4 text-amber-800">
                  <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {warning || "구글 시트가 연결되지 않아 임시로만 저장됩니다."}
                </p>
              )}

              {persistent !== false && (
                <p className="px-1 pb-2 pt-2 text-center text-[10.5px] leading-4 text-slate-400">
                  추가하면 구글 시트 ‘직원목록’에 이름과 등록일시가 함께 기록됩니다
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

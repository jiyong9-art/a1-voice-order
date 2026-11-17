"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm({
  teamMembers,
  passcodeConfigured,
}: {
  teamMembers: string[];
  passcodeConfigured: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(teamMembers[0] ?? "");
  const [customName, setCustomName] = useState("");
  const [useCustom, setUseCustom] = useState(teamMembers.length === 0);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const finalName = useCustom ? customName.trim() : name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!finalName) {
      setError("이름을 선택하거나 입력해 주세요.");
      return;
    }
    if (!passcode.trim()) {
      setError("팀 비밀번호를 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: finalName, passcode }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "로그인에 실패했습니다.");
        setLoading(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
      {!passcodeConfigured && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] leading-relaxed text-amber-800">
          서버에 <b>APP_PASSCODE</b>가 아직 설정되지 않았습니다. 배포 환경변수를 먼저 등록해 주세요.
        </div>
      )}

      <label className="block text-[13px] font-semibold text-slate-700">누구세요?</label>
      <div className="mt-2 flex flex-wrap gap-2">
        {teamMembers.map((member) => {
          const active = !useCustom && name === member;
          return (
            <button
              type="button"
              key={member}
              onClick={() => {
                setUseCustom(false);
                setName(member);
              }}
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
                active
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {member}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setUseCustom(true)}
          className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
            useCustom ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          직접 입력
        </button>
      </div>

      {useCustom && (
        <input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="이름 (예: 김대리)"
          maxLength={20}
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] outline-none focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
        />
      )}

      <label htmlFor="passcode" className="mt-5 block text-[13px] font-semibold text-slate-700">
        팀 비밀번호
      </label>
      <input
        id="passcode"
        type="password"
        inputMode="text"
        autoComplete="current-password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        placeholder="사내 공용 비밀번호"
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] tracking-widest outline-none focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
      />

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-5 w-full rounded-2xl bg-indigo-600 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-indigo-200 transition active:scale-[0.99] disabled:opacity-60"
      >
        {loading ? "확인 중…" : "들어가기"}
      </button>
    </form>
  );
}

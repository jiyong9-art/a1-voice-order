"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EditIcon } from "./icons";
import MemberEditor from "./MemberEditor";

export default function LoginForm({
  initialMembers,
  passcodeConfigured,
}: {
  initialMembers: string[];
  passcodeConfigured: boolean;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<string[]>(initialMembers);
  const [name, setName] = useState(initialMembers[0] ?? "");
  const [customName, setCustomName] = useState("");
  const [useCustom, setUseCustom] = useState(initialMembers.length === 0);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  // 직원 목록은 /api/members(구글 시트 ‘직원목록’)에서 불러옵니다.
  useEffect(() => {
    let alive = true;
    fetch("/api/members", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { members?: string[] }) => {
        if (!alive || !Array.isArray(data.members)) return;
        setMembers(data.members);
        if (data.members.length === 0) setUseCustom(true);
      })
      .catch(() => {
        /* 목록을 못 불러오면 서버에서 받은 기본 명단을 그대로 씁니다 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 선택한 이름이 목록에서 사라지면(직원 삭제) 첫 번째 이름으로 맞춥니다.
  useEffect(() => {
    if (useCustom) return;
    if (name && members.includes(name)) return;
    setName(members[0] ?? "");
    if (members.length === 0) setUseCustom(true);
  }, [members, name, useCustom]);

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
    <>
      <form onSubmit={submit} className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
        {!passcodeConfigured && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] leading-relaxed text-amber-800">
            서버에 <b>APP_PASSCODE</b>가 아직 설정되지 않았습니다. 배포 환경변수를 먼저 등록해 주세요.
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <label className="block text-[13px] font-semibold text-slate-700">누구세요?</label>
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="flex items-center gap-1 rounded-full border border-brand-border bg-brand-light px-2.5 py-1 text-[11.5px] font-semibold text-brand transition hover:bg-brand-border/40"
          >
            <EditIcon className="h-3 w-3" />
            직원 편집
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {members.map((member) => {
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
                    ? "bg-brand text-white shadow-sm shadow-brand/25"
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
              useCustom ? "bg-brand text-white shadow-sm shadow-brand/25" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
            className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] outline-none focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand-border/60"
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
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] tracking-widest outline-none focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand-border/60"
        />

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-2xl bg-brand py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
        >
          {loading ? "확인 중…" : "들어가기"}
        </button>
      </form>

      <MemberEditor
        open={editorOpen}
        members={members}
        onClose={() => setEditorOpen(false)}
        onMembersChange={setMembers}
      />
    </>
  );
}

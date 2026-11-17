import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getSession } from "@/lib/auth";
import { defaultTeamMembers, isSet } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "에이원 업무 오더 · 팀 로그인",
};

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl font-black text-white shadow-lg shadow-indigo-200">
            i&amp;u
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">음성 업무 오더</h1>
          <p className="mt-1.5 text-sm text-slate-500">말로 지시하면 시트와 메일로 정리됩니다</p>
        </div>

        <LoginForm teamMembers={defaultTeamMembers()} passcodeConfigured={isSet("APP_PASSCODE")} />

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400">
          (주)i&amp;u 사내 전용 · 팀 비밀번호를 아는 직원만 사용할 수 있습니다.
        </p>
      </div>
    </main>
  );
}

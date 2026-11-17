import Image from "next/image";
import { redirect } from "next/navigation";
import logoSquare from "@/public/logo-a1-square.png";
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
        <div className="mb-7 text-center">
          <Image
            src={logoSquare}
            alt="에이원코리아 A1KOREA"
            priority
            className="mx-auto mb-4 h-32 w-auto sm:h-36"
          />
          <h1 className="text-xl font-bold tracking-tight text-slate-900">음성 업무 오더</h1>
          <p className="mt-1.5 text-sm text-slate-500">말로 지시하면 내 기기와 드라이브에 정리됩니다</p>
        </div>

        <LoginForm initialMembers={defaultTeamMembers()} passcodeConfigured={isSet("APP_PASSCODE")} />

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400">
          에이원코리아(A1KOREA) 사내 전용 · 팀 비밀번호를 아는 직원만 사용할 수 있습니다.
        </p>
      </div>
    </main>
  );
}

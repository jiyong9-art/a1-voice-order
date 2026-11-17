import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { aiConfigured, mockAiEnabled } from "@/lib/ai";
import { getSession } from "@/lib/auth";
import { defaultTeamMembers, isSet, mailConfigured, sheetsConfigured, sheetsUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell
      userName={session.name}
      teamMembers={defaultTeamMembers()}
      status={{
        ai: aiConfigured(),
        sheets: sheetsConfigured(),
        mail: mailConfigured(),
        mock: mockAiEnabled(),
        hasPasscode: isSet("APP_PASSCODE"),
        spreadsheetUrl: sheetsUrl(),
      }}
    />
  );
}

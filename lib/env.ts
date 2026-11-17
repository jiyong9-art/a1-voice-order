/**
 * 서버 전용 환경변수 읽기 도우미.
 * 값이 비어 있으면 "미설정"으로 보고, 기능별로 우아하게 건너뛰는 데 사용합니다.
 */

export function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function isSet(name: string): boolean {
  return readEnv(name).length > 0;
}

/** 앱 전체가 실제로 동작하는 데 꼭 필요한 값 */
export function appConfig() {
  return {
    passcode: readEnv("APP_PASSCODE"),
    teamMembers: readEnv("TEAM_MEMBERS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    vocabulary: readEnv("COMPANY_VOCABULARY"),
    spreadsheetId: readEnv("GOOGLE_SPREADSHEET_ID"),
    spreadsheetUrl: readEnv("GOOGLE_SPREADSHEET_URL"),
    serviceAccountJson: readEnv("GOOGLE_SERVICE_ACCOUNT_JSON"),
    openaiKey: readEnv("OPENAI_API_KEY"),
    transcribeModel: readEnv("OPENAI_TRANSCRIBE_MODEL") || "gpt-4o-transcribe",
    chatModel: readEnv("OPENAI_CHAT_MODEL") || "gpt-4o-mini",
    resendKey: readEnv("RESEND_API_KEY"),
    resendFrom: readEnv("MAIL_FROM") || "에이원 업무오더 <onboarding@resend.dev>",
    smtpHost: readEnv("SMTP_HOST"),
    smtpPort: readEnv("SMTP_PORT") || "587",
    smtpUser: readEnv("SMTP_USER"),
    smtpPass: readEnv("SMTP_PASS"),
    smtpFrom: readEnv("SMTP_FROM") || readEnv("SMTP_USER"),
    notifyEmail: readEnv("NOTIFY_EMAIL"),
    sessionSecret: readEnv("APP_SESSION_SECRET"),
    mockAi: readEnv("MOCK_AI").toLowerCase() === "true",
    region: readEnv("TZ_NAME") || "Asia/Seoul",
  };
}

export const DEFAULT_VOCABULARY =
  "에이원코리아, A1, 에이원, 에이팩스미디어, 인유, 문지용, 이광훈, 송현준, 백남우, 김남국, 한원석, 차정호, 유병은, 보험, 설계사, 약관, 후유장해, 고객, 상담, 녹취, 업무오더";

export function vocabularyPrompt(): string {
  const extra = appConfig().vocabulary;
  return extra ? `${DEFAULT_VOCABULARY}, ${extra}` : DEFAULT_VOCABULARY;
}

export const DEFAULT_TEAM_MEMBERS = [
  "문지용",
  "이광훈",
  "송현준",
  "백남우",
  "김남국",
  "한원석",
  "차정호",
  "유병은",
];

export function defaultTeamMembers(): string[] {
  const envList = appConfig().teamMembers;
  return envList.length > 0 ? envList : DEFAULT_TEAM_MEMBERS;
}

/** 구글 시트 자동 기록이 가능한 상태인지 */
export function sheetsConfigured(): boolean {
  const c = appConfig();
  return Boolean(c.spreadsheetId && c.serviceAccountJson);
}

/** 메일 발송이 가능한 상태인지 */
export function mailConfigured(): boolean {
  const c = appConfig();
  return Boolean(c.resendKey || (c.smtpHost && c.smtpUser && c.smtpPass));
}

export function sheetsUrl(): string | null {
  const c = appConfig();
  if (c.spreadsheetUrl) return c.spreadsheetUrl;
  if (c.spreadsheetId) return `https://docs.google.com/spreadsheets/d/${c.spreadsheetId}/edit`;
  return null;
}

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
    adminPasscode: readEnv("ADMIN_PASSCODE"),
    teamMembers: readEnv("TEAM_MEMBERS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    vocabulary: readEnv("COMPANY_VOCABULARY"),
    spreadsheetId: readEnv("GOOGLE_SPREADSHEET_ID"),
    spreadsheetUrl: readEnv("GOOGLE_SPREADSHEET_URL"),
    serviceAccountJson: readEnv("GOOGLE_SERVICE_ACCOUNT_JSON"),
    appsScriptUrl: readEnv("GOOGLE_APPS_SCRIPT_URL"),
    appsScriptSecret: readEnv("GOOGLE_APPS_SCRIPT_SECRET"),
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
  "에이원코리아, A1, 에이원, 에이팩스미디어, A1KOREA, 문지용, 이광훈, 송현준, 백남우, 김남국, 한원석, 차정호, 유병은, 보험, 설계사, 약관, 후유장해, 고객, 상담, 녹취, 업무오더";

export function vocabularyPrompt(): string {
  const extra = appConfig().vocabulary;
  return extra ? `${DEFAULT_VOCABULARY}, ${extra}` : DEFAULT_VOCABULARY;
}

/**
 * 프롬프트 에코(빈칸 환각) 판별에 쓰는 고유명사 목록 (v1.8).
 * 변환 결과가 이 목록만으로 이루어져 있으면 '말한 내용'이 아니라 힌트를 읽은 것으로 본다.
 */
export function vocabularyHints(): string[] {
  return vocabularyPrompt()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

/**
 * 구글 시트 연동 방식
 * - apps_script: 구글 시트에 붙인 Apps Script 웹앱(가장 간단, 서비스 계정 키 불필요)
 * - service_account: 서비스 계정 JSON으로 Sheets API 직접 호출
 * - none: 연동 없음
 */
export type SheetsBackend = "apps_script" | "service_account" | "none";

export function sheetsBackend(): SheetsBackend {
  const c = appConfig();
  if (c.appsScriptUrl) return "apps_script";
  if (c.spreadsheetId && c.serviceAccountJson) return "service_account";
  return "none";
}

/** 구글 시트 자동 기록이 가능한 상태인지 */
export function sheetsConfigured(): boolean {
  return sheetsBackend() !== "none";
}

/** 메일 발송이 가능한 상태인지 */
export function mailConfigured(): boolean {
  const c = appConfig();
  return Boolean(c.resendKey || (c.smtpHost && c.smtpUser && c.smtpPass));
}

/**
 * 직원 추가·삭제 권한 — 관리자 전용 비밀번호.
 * ADMIN_PASSCODE가 있으면 그것만 인정하고, 없을 때만 APP_PASSCODE로 대신합니다(안전한 fallback).
 */
export function adminPasscode(): string {
  const c = appConfig();
  return c.adminPasscode || c.passcode;
}

/** 관리자 전용 비밀번호가 따로 설정되어 있는지 */
export function adminPasscodeDedicated(): boolean {
  return isSet("ADMIN_PASSCODE");
}

export function sheetsUrl(): string | null {
  const c = appConfig();
  if (c.spreadsheetUrl) return c.spreadsheetUrl;
  if (c.spreadsheetId) return `https://docs.google.com/spreadsheets/d/${c.spreadsheetId}/edit`;
  return null;
}

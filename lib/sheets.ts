import { sheets as sheetsApi, type sheets_v4 } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { appConfig, sheetsBackend, sheetsConfigured } from "@/lib/env";
import type { CallSummaryResult, OrderResult } from "@/lib/types";

export const ORDER_TAB = "업무오더";
export const SUMMARY_TAB = "통화요약";
export const STAFF_TAB = "직원목록";

export const ORDER_HEADERS = [
  "등록일시",
  "지시자",
  "담당자",
  "긴급도",
  "업무제목",
  "상세내용",
  "기한",
  "상태",
  "음성원문",
];

export const SUMMARY_HEADERS = [
  "등록일시",
  "작성자",
  "고객명",
  "핵심요청",
  "약속사항",
  "기한",
  "다음할일",
  "요약",
  "음성원문",
];

/** 직원목록 탭: A 이름 · B 등록일시 · C 직원 전용 시트ID */
export const STAFF_HEADERS = ["이름", "등록일시", "시트ID"];

export interface StaffRow {
  name: string;
  registeredAt: string;
  /** 직원 전용 스프레드시트 ID (없으면 마스터 시트에 기록) */
  sheetId: string;
}

export interface SheetWriteResult {
  tab: string;
  row?: number;
  spreadsheetId?: string;
  url?: string;
  target: "master" | "personal";
  createdTab: boolean;
}

export interface StaffWriteResult {
  sheetId?: string;
  url?: string;
}

function parseServiceAccount(raw: string): Record<string, unknown> {
  // Vercel 환경변수에 JSON을 넣으면 줄바꿈이 \n 문자열로 들어오는 경우가 많습니다.
  const candidates = [raw, raw.replace(/\\n/g, "\n")];
  let lastErr: unknown = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && "client_email" in parsed && "private_key" in parsed) {
        return parsed as Record<string, unknown>;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  // base64로 넣은 경우도 지원
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed?.client_email) return parsed as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  throw new Error(
    `GOOGLE_SERVICE_ACCOUNT_JSON을 해석하지 못했습니다. 서비스 계정 키 JSON 전체를 넣어 주세요.${
      lastErr ? ` (${(lastErr as Error).message})` : ""
    }`,
  );
}

function sheetsClient(): sheets_v4.Sheets {
  const c = appConfig();
  if (!c.spreadsheetId || !c.serviceAccountJson) {
    throw new Error("구글 시트가 아직 연결되지 않았습니다.");
  }
  const credentials = parseServiceAccount(c.serviceAccountJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return sheetsApi({ version: "v4", auth });
}

export function spreadsheetReady(): boolean {
  return sheetsConfigured();
}

function isMissingRange(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Unable to parse range|not found|NOT_FOUND|400/i.test(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 구글 스프레드시트 파일 ID 형식인지 (직급·이메일 같은 값을 ID로 쓰지 않도록) */
function looksLikeSheetId(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,}$/.test(value) && !value.includes("@");
}

export function spreadsheetUrlById(spreadsheetId: string | undefined | null): string | undefined {
  if (!spreadsheetId) return undefined;
  const c = appConfig();
  if (c.spreadsheetUrl && c.spreadsheetId === spreadsheetId) return c.spreadsheetUrl;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/* ------------------------------------------------------------------ */
/* Apps Script 웹앱 (서비스 계정 없이 연동)                              */
/* ------------------------------------------------------------------ */

interface AppsScriptResponse {
  ok?: boolean;
  error?: string;
  staff?: unknown;
  sheetId?: string;
  url?: string;
  removed?: boolean;
  reason?: string;
  tab?: string;
  row?: number;
  spreadsheetId?: string;
  target?: string;
  createdTab?: boolean;
}

async function callAppsScript(action: string, payload: Record<string, unknown> = {}): Promise<AppsScriptResponse> {
  const c = appConfig();
  if (!c.appsScriptUrl) throw new Error("GOOGLE_APPS_SCRIPT_URL이 설정되지 않았습니다.");
  const res = await fetch(c.appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, secret: c.appsScriptSecret, ...payload }),
    redirect: "follow",
    cache: "no-store",
  });
  const text = await res.text();
  let data: AppsScriptResponse | null = null;
  try {
    data = JSON.parse(text) as AppsScriptResponse;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(`시트 연동(Apps Script) 응답 오류 ${res.status}: ${text.slice(0, 160)}`);
  }
  if (!data || data.ok !== true) {
    throw new Error(data?.error ?? `시트 연동(Apps Script) 응답을 해석하지 못했습니다: ${text.slice(0, 160)}`);
  }
  return data;
}

function normalizeStaffRows(raw: unknown): StaffRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: StaffRow[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      const name = String(item[0] ?? "").trim();
      if (!name) continue;
      const sheetId = String(item[2] ?? "").trim();
      rows.push({
        name,
        registeredAt: String(item[1] ?? "").trim(),
        sheetId: looksLikeSheetId(sheetId) ? sheetId : "",
      });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const name = String(obj.name ?? "").trim();
      if (!name) continue;
      const sheetId = String(obj.sheetId ?? "").trim();
      rows.push({
        name,
        registeredAt: String(obj.registeredAt ?? "").trim(),
        sheetId: looksLikeSheetId(sheetId) ? sheetId : "",
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* 직원목록                                                             */
/* ------------------------------------------------------------------ */

/** 직원목록을 읽습니다. 탭이 없으면 null(환경변수 기본값으로 대체). */
export async function listStaffRows(): Promise<StaffRow[] | null> {
  const backend = sheetsBackend();

  if (backend === "apps_script") {
    const res = await callAppsScript("members:list");
    return normalizeStaffRows(res.staff);
  }

  if (backend === "service_account") {
    const c = appConfig();
    const sheets = sheetsClient();
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: c.spreadsheetId,
        range: `'${STAFF_TAB}'!A2:C`,
      });
      const rows = res.data.values ?? [];
      return rows
        .map((row) => {
          const name = String(row[0] ?? "").trim();
          const second = String(row[1] ?? "").trim();
          const third = String(row[2] ?? "").trim();
          return {
            name,
            // 예전 스키마(B열 이메일)도 읽을 수 있게 날짜만 등록일시로 인정합니다.
            registeredAt: /@/.test(second) ? "" : second,
            sheetId: looksLikeSheetId(third) ? third : "",
          };
        })
        .filter((row) => row.name);
    } catch (err) {
      if (isMissingRange(err)) return null;
      throw err;
    }
  }

  return null;
}

/** 직원 이름으로 그 직원의 전용 시트ID를 찾습니다. */
export async function findStaffSheet(name: string): Promise<StaffRow | null> {
  const wanted = name.replace(/\s/g, "");
  if (!wanted) return null;
  const rows = (await listStaffRows()) ?? [];
  const exact = rows.find((row) => row.name.replace(/\s/g, "") === wanted);
  if (exact) return exact;
  return rows.find((row) => row.name.replace(/\s/g, "").includes(wanted) || wanted.includes(row.name.replace(/\s/g, ""))) ?? null;
}

/** 직원을 직원목록에 추가합니다. Apps Script 모드에서는 전용 시트까지 만들어 줍니다. */
export async function addStaffRow(name: string, registeredAt: string): Promise<StaffWriteResult> {
  const backend = sheetsBackend();

  if (backend === "apps_script") {
    const res = await callAppsScript("members:add", { name, registeredAt });
    const sheetId = typeof res.sheetId === "string" && looksLikeSheetId(res.sheetId) ? res.sheetId : undefined;
    return { sheetId, url: typeof res.url === "string" ? res.url : spreadsheetUrlById(sheetId) };
  }

  if (backend === "service_account") {
    await appendRowTo(appConfig().spreadsheetId, STAFF_TAB, STAFF_HEADERS, [name, registeredAt, ""]);
    return {};
  }

  throw new Error("구글 시트가 아직 연결되지 않았습니다.");
}

/** 직원을 직원목록에서 제거합니다. (전용 시트 파일은 지우지 않습니다) */
export async function removeStaffRow(name: string): Promise<{ removed: boolean; reason?: string }> {
  const backend = sheetsBackend();
  const wanted = name.replace(/\s/g, "");
  if (!wanted) return { removed: false, reason: "이름이 비어 있습니다." };

  if (backend === "apps_script") {
    const res = await callAppsScript("members:remove", { name });
    return { removed: res.removed !== false, reason: res.reason };
  }

  if (backend !== "service_account") {
    return { removed: false, reason: "구글 시트가 아직 연결되지 않았습니다." };
  }

  const c = appConfig();
  const sheets = sheetsClient();
  const spreadsheetId = c.spreadsheetId;

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const sheet = (meta.data.sheets ?? []).find((s) => s.properties?.title === STAFF_TAB);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    return { removed: false, reason: "직원목록 탭이 없습니다." };
  }

  let rows: unknown[][] = [];
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${STAFF_TAB}'!A:A` });
    rows = res.data.values ?? [];
  } catch (err) {
    if (isMissingRange(err)) return { removed: false, reason: "직원목록 탭이 없습니다." };
    throw err;
  }

  const targets: number[] = [];
  rows.forEach((row, index) => {
    if (index === 0) return; // 헤더
    if (String(row[0] ?? "").replace(/\s/g, "") === wanted) targets.push(index);
  });
  if (targets.length === 0) return { removed: false, reason: "직원목록에서 이름을 찾지 못했습니다." };

  // 아래쪽 행부터 지워야 위쪽 행 번호가 밀리지 않습니다.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: targets
        .sort((a, b) => b - a)
        .map((startIndex) => ({
          deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex, endIndex: startIndex + 1 } },
        })),
    },
  });
  return { removed: true };
}

/** 직원목록에서 이름으로 이메일을 찾습니다. (이메일 칸이 있는 예전 스키마 호환) */
export async function findStaffEmail(name: string): Promise<{ email: string; title?: string } | null> {
  const wanted = name.replace(/\s/g, "");
  if (!wanted) return null;
  if (sheetsBackend() !== "service_account") return null;

  const c = appConfig();
  const sheets = sheetsClient();
  let rows: unknown[][] = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: c.spreadsheetId,
      range: `'${STAFF_TAB}'!A2:E`,
    });
    rows = res.data.values ?? [];
  } catch (err) {
    if (isMissingRange(err)) return null;
    throw err;
  }

  const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  for (const row of rows) {
    const rowName = String(row[0] ?? "").replace(/\s/g, "");
    if (!rowName || !(rowName === wanted || rowName.includes(wanted) || wanted.includes(rowName))) continue;
    const cells = row.slice(1).map((value) => String(value ?? "").trim());
    const email = cells.find(isEmail);
    if (!email) continue; // 등록일시·시트ID만 있는 지금 스키마에는 이메일이 없습니다.
    const title = cells.find((value) => value && !isEmail(value) && !/^\d{4}-\d{2}-\d{2}/.test(value));
    return { email, title };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 업무오더 · 통화요약 행 추가                                           */
/* ------------------------------------------------------------------ */

async function ensureSheet(
  sheets: ReturnType<typeof sheetsClient>,
  spreadsheetId: string,
  tab: string,
  headers: string[],
): Promise<boolean> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
  if (titles.includes(tab)) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });
  return true;
}

async function appendRowTo(
  spreadsheetId: string,
  tab: string,
  headers: string[],
  row: (string | number)[],
): Promise<{ tab: string; createdTab: boolean; row?: number }> {
  const sheets = sheetsClient();

  const doAppend = () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tab}'!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

  let res;
  let createdTab = false;
  try {
    res = await doAppend();
  } catch (err) {
    if (isMissingRange(err)) {
      createdTab = await ensureSheet(sheets, spreadsheetId, tab, headers);
      res = await doAppend();
    } else {
      throw err;
    }
  }

  const updatedRange = res.data.updates?.updatedRange ?? "";
  const rowMatch = updatedRange.match(/![A-Z]+(\d+)/);
  return { tab, createdTab, row: rowMatch ? Number(rowMatch[1]) : undefined };
}

async function writeEmployeeRow(opts: {
  action: "submit:order" | "submit:summary";
  sender: string;
  tab: string;
  headers: string[];
  values: (string | number)[];
  data: unknown;
}): Promise<SheetWriteResult> {
  const backend = sheetsBackend();

  if (backend === "apps_script") {
    const res = await callAppsScript(opts.action, { sender: opts.sender, registeredAt: opts.values[0], data: opts.data });
    const spreadsheetId = typeof res.spreadsheetId === "string" && res.spreadsheetId ? res.spreadsheetId : undefined;
    return {
      tab: typeof res.tab === "string" && res.tab ? res.tab : opts.tab,
      row: typeof res.row === "number" ? res.row : undefined,
      spreadsheetId,
      url: typeof res.url === "string" && res.url ? res.url : spreadsheetUrlById(spreadsheetId),
      target: res.target === "personal" ? "personal" : "master",
      createdTab: Boolean(res.createdTab),
    };
  }

  if (backend === "service_account") {
    // 작성자(로그인한 직원)의 전용 시트가 있으면 그곳에 기록합니다.
    let staff: StaffRow | null = null;
    try {
      staff = await findStaffSheet(opts.sender);
    } catch {
      staff = null;
    }
    const spreadsheetId = staff?.sheetId || appConfig().spreadsheetId;
    const appended = await appendRowTo(spreadsheetId, opts.tab, opts.headers, opts.values);
    return {
      tab: appended.tab,
      row: appended.row,
      spreadsheetId,
      url: spreadsheetUrlById(spreadsheetId),
      target: staff?.sheetId ? "personal" : "master",
      createdTab: appended.createdTab,
    };
  }

  throw new Error("구글 시트가 아직 연결되지 않았습니다.");
}

export async function appendOrderRow(
  order: OrderResult,
  sender: string,
  registeredAt: string,
): Promise<SheetWriteResult> {
  return writeEmployeeRow({
    action: "submit:order",
    sender,
    tab: ORDER_TAB,
    headers: ORDER_HEADERS,
    values: [
      registeredAt,
      sender,
      order.assignee,
      order.priority,
      order.title,
      order.details,
      order.due_date || "-",
      "신규",
      order.raw_transcript,
    ],
    data: { ...order, sender, registeredAt },
  });
}

export async function appendSummaryRow(
  summary: CallSummaryResult,
  sender: string,
  registeredAt: string,
): Promise<SheetWriteResult> {
  return writeEmployeeRow({
    action: "submit:summary",
    sender,
    tab: SUMMARY_TAB,
    headers: SUMMARY_HEADERS,
    values: [
      registeredAt,
      sender,
      summary.customer_name,
      summary.key_requests.join("\n"),
      summary.promises.join("\n"),
      summary.due_date || "-",
      summary.next_actions.join("\n"),
      summary.summary,
      summary.raw_transcript,
    ],
    data: { ...summary, sender, registeredAt },
  });
}

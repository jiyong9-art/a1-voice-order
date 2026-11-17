import { sheets as sheetsApi, type sheets_v4 } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { appConfig, sheetsConfigured } from "@/lib/env";
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

async function ensureSheet(
  sheets: ReturnType<typeof sheetsClient>,
  spreadsheetId: string,
  tab: string,
  headers: string[],
): Promise<boolean> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter(Boolean);
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

async function appendRow(tab: string, headers: string[], row: (string | number)[]) {
  const c = appConfig();
  const sheets = sheetsClient();
  const spreadsheetId = c.spreadsheetId;
  let createdTab = false;

  const doAppend = () =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tab}'!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

  let res;
  try {
    res = await doAppend();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Unable to parse range|not found|NOT_FOUND|400/i.test(message)) {
      createdTab = await ensureSheet(sheets, spreadsheetId, tab, headers);
      res = await doAppend();
    } else {
      throw err;
    }
  }

  const updatedRange = res.data.updates?.updatedRange ?? "";
  const rowMatch = updatedRange.match(/![A-Z]+(\d+)/);
  return {
    tab,
    createdTab,
    row: rowMatch ? Number(rowMatch[1]) : undefined,
  };
}

/** 직원목록 탭에서 이름으로 이메일을 찾습니다. */
export async function findStaffEmail(name: string): Promise<{ email: string; title?: string } | null> {
  const wanted = name.replace(/\s/g, "");
  if (!wanted) return null;
  const c = appConfig();
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: c.spreadsheetId,
    range: `'${STAFF_TAB}'!A2:C`,
  });
  const rows = res.data.values ?? [];
  for (const row of rows) {
    const rowName = String(row[0] ?? "").replace(/\s/g, "");
    const email = String(row[1] ?? "").trim();
    if (rowName && email && (rowName === wanted || rowName.includes(wanted) || wanted.includes(rowName))) {
      return { email, title: String(row[2] ?? "").trim() || undefined };
    }
  }
  return null;
}

export async function appendOrderRow(order: OrderResult, sender: string, registeredAt: string) {
  return appendRow(ORDER_TAB, ORDER_HEADERS, [
    registeredAt,
    sender,
    order.assignee,
    order.priority,
    order.title,
    order.details,
    order.due_date || "-",
    "신규",
    order.raw_transcript,
  ]);
}

export async function appendSummaryRow(summary: CallSummaryResult, sender: string, registeredAt: string) {
  return appendRow(SUMMARY_TAB, SUMMARY_HEADERS, [
    registeredAt,
    sender,
    summary.customer_name,
    summary.key_requests.join("\n"),
    summary.promises.join("\n"),
    summary.due_date || "-",
    summary.next_actions.join("\n"),
    summary.summary,
    summary.raw_transcript,
  ]);
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appConfig, sheetsConfigured, sheetsUrl } from "@/lib/env";
import { appendOrderRow, appendSummaryRow, findStaffEmail } from "@/lib/sheets";
import { mailReady, sendOrderMail, sendSummaryMail } from "@/lib/mail";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { CallSummaryResult, OrderResult, Priority } from "@/lib/types";
import { PRIORITIES, formatKoreanDateTime } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function strArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => str(v)).filter(Boolean);
  return [];
}

function normalizeOrder(input: Record<string, unknown>): OrderResult {
  const priority = str(input.priority);
  return {
    assignee: str(input.assignee, "미지정") || "미지정",
    title: str(input.title, "(제목 없음)") || "(제목 없음)",
    details: str(input.details),
    due_date: str(input.due_date),
    priority: (PRIORITIES as string[]).includes(priority) ? (priority as Priority) : "보통",
    raw_transcript: str(input.raw_transcript),
  };
}

function normalizeSummary(input: Record<string, unknown>): CallSummaryResult {
  return {
    customer_name: str(input.customer_name, "미확인") || "미확인",
    key_requests: strArray(input.key_requests),
    promises: strArray(input.promises),
    due_date: str(input.due_date),
    next_actions: strArray(input.next_actions),
    summary: str(input.summary),
    raw_transcript: str(input.raw_transcript),
  };
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limit = rateLimit(`submit:${session.name}:${clientIp(request)}`, 120, 60 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: "등록 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  let body: { mode?: string; data?: Record<string, unknown> };
  try {
    body = (await request.json()) as { mode?: string; data?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json({ ok: false, error: "등록할 내용이 없습니다." }, { status: 400 });
  }

  const mode = body.mode === "call_summary" ? "call_summary" : "order";
  const sender = session.name;
  const registeredAt = formatKoreanDateTime(new Date());
  const cfg = appConfig();

  try {
    if (mode === "order") {
      const order = normalizeOrder(body.data);
      if (!order.details && !order.title) {
        return NextResponse.json({ ok: false, error: "업무 내용을 확인해 주세요." }, { status: 400 });
      }

      const result = {
        ok: true,
        sheet: { skipped: false as boolean, reason: "", tab: "업무오더", row: undefined as number | undefined, url: sheetsUrl() ?? undefined },
        mail: { skipped: false as boolean, reason: "", to: [] as string[] },
        registeredAt,
      };

      if (!sheetsConfigured()) {
        result.sheet.skipped = true;
        result.sheet.reason = "구글 시트가 아직 연결되지 않았습니다 (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SPREADSHEET_ID).";
      } else {
        const appended = await appendOrderRow(order, sender, registeredAt);
        result.sheet.tab = appended.tab;
        result.sheet.row = appended.row;
      }

      const recipients: string[] = [];
      let lookupNote = "";
      if (sheetsConfigured()) {
        try {
          const staff = await findStaffEmail(order.assignee);
          if (staff?.email) recipients.push(staff.email);
        } catch (err) {
          lookupNote = `직원목록 탭을 읽지 못했습니다. (${err instanceof Error ? err.message.slice(0, 120) : "오류"})`;
        }
      }
      if (cfg.notifyEmail) recipients.push(cfg.notifyEmail);
      const to = Array.from(new Set(recipients.filter(Boolean)));

      if (!mailReady()) {
        result.mail.skipped = true;
        result.mail.reason = "메일 발송 설정이 아직 없습니다 (RESEND_API_KEY 또는 SMTP_*).";
      } else if (to.length === 0) {
        result.mail.skipped = true;
        result.mail.reason =
          lookupNote || `직원목록 탭에서 '${order.assignee}'의 이메일을 찾지 못했습니다.`;
      } else {
        try {
          await sendOrderMail(order, sender, registeredAt, to);
          result.mail.to = to;
        } catch (err) {
          // 시트에는 이미 기록되었으므로, 메일 실패는 등록 실패로 처리하지 않습니다.
          result.mail.skipped = true;
          result.mail.reason = `메일 발송에 실패했습니다. (${err instanceof Error ? err.message.slice(0, 160) : "오류"})`;
        }
      }

      return NextResponse.json(result);
    }

    const summary = normalizeSummary(body.data);
    const result = {
      ok: true,
      sheet: { skipped: false as boolean, reason: "", tab: "통화요약", row: undefined as number | undefined, url: sheetsUrl() ?? undefined },
      mail: { skipped: false as boolean, reason: "", to: [] as string[] },
      registeredAt,
    };

    if (!sheetsConfigured()) {
      result.sheet.skipped = true;
      result.sheet.reason = "구글 시트가 아직 연결되지 않았습니다 (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SPREADSHEET_ID).";
    } else {
      const appended = await appendSummaryRow(summary, sender, registeredAt);
      result.sheet.tab = appended.tab;
      result.sheet.row = appended.row;
    }

    const to = Array.from(new Set([cfg.notifyEmail].filter(Boolean)));
    if (!mailReady()) {
      result.mail.skipped = true;
      result.mail.reason = "메일 발송 설정이 아직 없습니다 (RESEND_API_KEY 또는 SMTP_*).";
    } else if (to.length === 0) {
      result.mail.skipped = true;
      result.mail.reason = "알림 받을 메일 주소(NOTIFY_EMAIL)가 설정되지 않았습니다.";
    } else {
      try {
        await sendSummaryMail(summary, sender, registeredAt, to);
        result.mail.to = to;
      } catch (err) {
        result.mail.skipped = true;
        result.mail.reason = `메일 발송에 실패했습니다. (${err instanceof Error ? err.message.slice(0, 160) : "오류"})`;
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `등록에 실패했습니다. (${message.slice(0, 300)})` },
      { status: 500 },
    );
  }
}

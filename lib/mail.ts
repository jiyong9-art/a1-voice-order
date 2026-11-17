import nodemailer from "nodemailer";
import { appConfig, mailConfigured } from "@/lib/env";
import type { CallSummaryResult, OrderResult } from "@/lib/types";

export function mailReady(): boolean {
  return mailConfigured();
}

interface MailInput {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

async function sendViaResend(input: MailInput): Promise<void> {
  const c = appConfig();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: c.resendFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend 발송 실패 (${res.status}): ${body.slice(0, 300)}`);
  }
}

async function sendViaSmtp(input: MailInput): Promise<void> {
  const c = appConfig();
  const port = Number(c.smtpPort) || 587;
  const transporter = nodemailer.createTransport({
    host: c.smtpHost,
    port,
    secure: port === 465,
    auth: c.smtpUser ? { user: c.smtpUser, pass: c.smtpPass } : undefined,
  });
  await transporter.sendMail({
    from: c.smtpFrom,
    to: input.to.join(", "),
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.replyTo,
  });
}

export async function sendMail(input: MailInput): Promise<void> {
  const c = appConfig();
  if (c.resendKey) {
    await sendViaResend(input);
    return;
  }
  if (c.smtpHost && c.smtpUser && c.smtpPass) {
    await sendViaSmtp(input);
    return;
  }
  throw new Error("메일 발송 설정(RESEND_API_KEY 또는 SMTP_*)이 없습니다.");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title: string, body: string): string {
  return `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;color:#003a84;font-weight:700">에이원코리아 업무오더</p>
  <h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>
  ${body}
  <p style="margin-top:24px;font-size:12px;color:#94a3b8">에이원코리아 업무 오더 웹앱에서 자동 발송된 메일입니다.</p>
</div>`;
}

function row(label: string, value: string): string {
  return `<tr><th style="text-align:left;padding:6px 12px 6px 0;font-size:13px;color:#64748b;white-space:nowrap;vertical-align:top">${escapeHtml(
    label,
  )}</th><td style="padding:6px 0;font-size:14px">${escapeHtml(value).replace(/\n/g, "<br/>")}</td></tr>`;
}

export async function sendOrderMail(order: OrderResult, sender: string, registeredAt: string, to: string[]) {
  const subject = `[에이원 업무오더] ${order.title} (${order.priority})`;
  const body = `<table style="border-collapse:collapse;width:100%">
  ${row("등록일시", registeredAt)}
  ${row("지시자", sender)}
  ${row("담당자", order.assignee)}
  ${row("긴급도", order.priority)}
  ${row("업무제목", order.title)}
  ${row("상세내용", order.details)}
  ${row("기한", order.due_date || "-")}
  ${row("음성원문", order.raw_transcript)}
  </table>`;
  const text = [
    `[에이원 업무오더] ${order.title}`,
    `등록일시: ${registeredAt}`,
    `지시자: ${sender}`,
    `담당자: ${order.assignee}`,
    `긴급도: ${order.priority}`,
    `상세내용: ${order.details}`,
    `기한: ${order.due_date || "-"}`,
    "",
    `음성원문: ${order.raw_transcript}`,
  ].join("\n");
  await sendMail({ to, subject, html: shell(order.title, body), text });
}

export async function sendSummaryMail(summary: CallSummaryResult, sender: string, registeredAt: string, to: string[]) {
  const subject = `[에이원 통화요약] ${summary.customer_name} · ${summary.due_date || "기한 미정"}`;
  const body = `<table style="border-collapse:collapse;width:100%">
  ${row("등록일시", registeredAt)}
  ${row("작성자", sender)}
  ${row("고객명", summary.customer_name)}
  ${row("핵심요청", summary.key_requests.map((v, i) => `${i + 1}. ${v}`).join("\n") || "-")}
  ${row("약속사항", summary.promises.map((v, i) => `${i + 1}. ${v}`).join("\n") || "-")}
  ${row("기한", summary.due_date || "-")}
  ${row("다음할일", summary.next_actions.map((v) => `- ${v}`).join("\n") || "-")}
  ${row("요약", summary.summary)}
  ${row("음성원문", summary.raw_transcript)}
  </table>`;
  const text = [
    `[에이원 통화요약] ${summary.customer_name}`,
    `등록일시: ${registeredAt}`,
    `작성자: ${sender}`,
    `핵심요청: ${summary.key_requests.join(" / ") || "-"}`,
    `약속사항: ${summary.promises.join(" / ") || "-"}`,
    `기한: ${summary.due_date || "-"}`,
    `다음할일: ${summary.next_actions.join(" / ") || "-"}`,
    `요약: ${summary.summary}`,
    "",
    `음성원문: ${summary.raw_transcript}`,
  ].join("\n");
  await sendMail({ to, subject, html: shell(`${summary.customer_name} 통화 요약`, body), text });
}

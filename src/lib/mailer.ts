// 메일 실제 발송 (서버 전용). 화면용 양식·mailto 는 email.ts
import "server-only";
import nodemailer from "nodemailer";
import type { EmailTemplate, MailResult } from "./types";
import { recipientAllowed } from "./util";

/**
 * 발송 방식
 * - SMTP: 네이버·Gmail·기관 메일 서버 등 일반 메일 계정으로 발송 (SMTP_HOST, SMTP_USER, SMTP_PASS)
 * - Resend: 발송 서비스 API (RESEND_API_KEY, EMAIL_FROM) — 발신 도메인 인증 필요
 * 둘 다 설정되면 SMTP 우선
 *
 * 수신자 제한(EMAIL_ALLOWED_RECIPIENTS)
 * - 쉼표로 구분한 주소 또는 @도메인. 목록에 있는 주소로만 위원 대상 메일을 보낸다.
 * - '*' 는 모든 주소 허용 (기관 승인 후 실운영 시에만 사용)
 */
export type MailProvider = "smtp" | "resend" | null;

export function emailServiceStatus() {
  const smtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const resend = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  const provider: MailProvider = smtp ? "smtp" : resend ? "resend" : null;
  const fromAddr = smtp ? process.env.EMAIL_FROM || process.env.SMTP_USER || "" : process.env.EMAIL_FROM || "";
  const allow = (process.env.EMAIL_ALLOWED_RECIPIENTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    configured: provider !== null,
    provider,
    from: fromAddr || null,
    fromName: process.env.EMAIL_FROM_NAME || null,
    replyTo: process.env.EMAIL_REPLY_TO || process.env.ADMIN_NOTIFY_EMAIL || null,
    allowList: allow,
    allowAll: allow.includes("*"),
  };
}

export { recipientAllowed };

function fromHeader() {
  const st = emailServiceStatus();
  if (!st.from) return "";
  return st.fromName ? `"${st.fromName.replace(/"/g, "")}" <${st.from}>` : st.from;
}

let transport: nodemailer.Transporter | null = null;
function smtpTransport() {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT || 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  return transport;
}

/** 테스트용 */
export function __resetMailerForTests() {
  transport = null;
}

function friendlySmtpError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Invalid login|535|authentication/i.test(msg))
    return "메일 계정 로그인 실패: SMTP_USER(전체 메일 주소)와 SMTP_PASS(앱 비밀번호)를 확인하고, 메일 환경설정에서 IMAP/SMTP 사용을 켜 주세요.";
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout/i.test(msg)) return `메일 서버에 연결하지 못했습니다(${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 465}). 주소·포트를 확인해 주세요.`;
  if (/sender|from/i.test(msg) && /reject|denied|not allowed|553|550/i.test(msg))
    return "보내는 주소가 거부되었습니다. EMAIL_FROM을 비우거나 로그인한 메일 주소와 같게 설정해 주세요.";
  return `메일 발송 실패: ${msg}`;
}

/** 실제 발송 (수신자 제한은 호출하는 쪽에서 확인) */
export async function sendMail(to: string, mail: EmailTemplate): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const st = emailServiceStatus();
  if (!st.provider) return { ok: false, error: "메일 발송 설정이 없습니다." };
  if (st.provider === "smtp") {
    try {
      const info = await smtpTransport().sendMail({
        from: fromHeader(),
        to,
        subject: mail.subject,
        text: mail.body,
        ...(st.replyTo ? { replyTo: st.replyTo } : {}),
      });
      return { ok: true, id: info.messageId || "" };
    } catch (e) {
      return { ok: false, error: friendlySmtpError(e) };
    }
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromHeader(), to: [to], subject: mail.subject, text: mail.body, ...(st.replyTo ? { reply_to: st.replyTo } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `발송 실패 (HTTP ${res.status})` };
    return { ok: true, id: data.id || "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "발송 중 오류가 발생했습니다." };
  }
}

/**
 * 위원 대상 공통 발송 — 예외를 던지지 않고 결과만 반환한다.
 * 발송 설정 없음·허용목록 외 주소는 'skipped' (관리자가 메일 앱으로 직접 보내도록 안내)
 */
export async function deliver(to: string | null | undefined, mail: EmailTemplate): Promise<MailResult> {
  const st = emailServiceStatus();
  if (!to) return { status: "skipped", detail: "이메일 미등록" };
  if (!st.configured) return { status: "skipped", detail: "메일 발송 설정 없음" };
  if (!recipientAllowed(to, st.allowList)) return { status: "skipped", detail: "발송 허용 주소가 아님" };
  const r = await sendMail(to, mail);
  return r.ok ? { status: "sent", detail: to } : { status: "failed", detail: r.error };
}

export function canAutoSend(to: string | null | undefined) {
  const st = emailServiceStatus();
  return Boolean(to && st.configured && recipientAllowed(to, st.allowList));
}

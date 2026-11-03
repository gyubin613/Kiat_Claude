import type { EmailTemplate, Evaluation, Evaluator, MailResult } from "./types";
import { formatDateKo, formatSlot } from "./util";

export const PLACEHOLDERS = [
  { key: "성명", desc: "평가위원 성명" },
  { key: "소속", desc: "평가위원 소속기관" },
  { key: "평가명", desc: "평가명" },
  { key: "담당부서", desc: "담당부서" },
  { key: "담당자", desc: "운영 담당자" },
  { key: "후보일정", desc: "후보 일정 목록" },
  { key: "회신기한", desc: "회신 기한" },
  { key: "요청사항", desc: "참여 요청사항" },
  { key: "회신링크", desc: "평가위원별 고유 회신 링크" },
] as const;

export const DEFAULT_TEMPLATE: EmailTemplate = {
  subject: "[{{담당부서}}] {{평가명}} 평가위원 참석 요청",
  body: `{{성명}} 위원님께

안녕하십니까. {{담당부서}} {{담당자}}입니다.
「{{평가명}}」의 평가위원으로 위원님을 모시고자 연락드립니다.

■ 후보 일정
{{후보일정}}

■ 참여 요청사항
{{요청사항}}

아래 링크에서 참석 여부와 가능한 일정을 {{회신기한}}까지 회신해 주시면 감사하겠습니다.
(별도 로그인이나 프로그램 설치 없이 바로 응답하실 수 있습니다.)

▶ 회신하기: {{회신링크}}

※ 본 링크는 위원님께만 발송된 개인 링크이므로 타인과 공유하지 말아 주십시오.

감사합니다.`,
};

export function renderTemplate(
  tpl: EmailTemplate,
  ctx: { evaluation: Evaluation; evaluator: Pick<Evaluator, "name" | "org">; link: string },
): EmailTemplate {
  const { evaluation: e, evaluator: v, link } = ctx;
  const values: Record<string, string> = {
    성명: v.name,
    소속: v.org || "",
    평가명: e.name,
    담당부서: e.department || "",
    담당자: e.contactName || "담당자",
    후보일정: e.slots.length ? e.slots.map((s, i) => `  ${i + 1}) ${formatSlot(s)}`).join("\n") : "  (추후 안내)",
    회신기한: formatDateKo(e.deadline),
    요청사항: e.requirements?.trim()
      ? e.requirements.trim().split("\n").map((l) => `  ${l.trim()}`).join("\n")
      : "  (별도 요청사항 없음)",
    회신링크: link,
  };
  const fill = (s: string) => s.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (m, key) => (key in values ? values[key] : m));
  return { subject: fill(tpl.subject).replace(/\s+/g, " ").trim(), body: fill(tpl.body) };
}

export function mailtoUrl(to: string, mail: EmailTemplate) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(
    mail.body,
  )}`;
}

// ---------- 외부 발송 서비스(Resend) 연동: 시험 발송 단계 ----------

export function emailServiceStatus() {
  const configured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  const allow = (process.env.EMAIL_ALLOWED_RECIPIENTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { configured, from: process.env.EMAIL_FROM || null, allowList: allow };
}

/** 수신자 제한: 허용목록이 비어 있으면 아무에게도 직접 발송하지 않는다(시험 발송 전용). */
export function recipientAllowed(email: string, allowList: string[]) {
  const e = email.trim().toLowerCase();
  return allowList.some((a) => (a.startsWith("@") ? e.endsWith(a) : e === a));
}

export async function sendViaResend(to: string, mail: EmailTemplate): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { configured, from } = emailServiceStatus();
  if (!configured || !from) return { ok: false, error: "이메일 발송 서비스가 설정되지 않았습니다." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.body }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `발송 실패 (HTTP ${res.status})` };
    return { ok: true, id: data.id || "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "발송 중 오류가 발생했습니다." };
  }
}

/**
 * 공통 발송 함수 — 예외를 던지지 않고 결과만 반환한다.
 * 발송 서비스 미설정·허용목록 밖 주소는 'skipped' (관리자가 수동 발송하도록 안내)
 */
export async function deliver(to: string | null | undefined, mail: EmailTemplate): Promise<MailResult> {
  const st = emailServiceStatus();
  if (!to) return { status: "skipped", detail: "이메일 미등록" };
  if (!st.configured) return { status: "skipped", detail: "발송 서비스 미설정" };
  if (!recipientAllowed(to, st.allowList)) return { status: "skipped", detail: "발송 허용목록 외 주소" };
  const r = await sendViaResend(to, mail);
  return r.ok ? { status: "sent", detail: to } : { status: "failed", detail: r.error };
}

export function canAutoSend(to: string | null | undefined) {
  const st = emailServiceStatus();
  return Boolean(to && st.configured && recipientAllowed(to, st.allowList));
}

const head = (e: Pick<Evaluation, "department" | "name">) => `${e.department ? `[${e.department}] ` : ""}${e.name}`;
const sign = (e: Pick<Evaluation, "department" | "contactName">) =>
  `\n\n${[e.department, e.contactName].filter(Boolean).join(" ") || "평가 운영 담당자"} 드림`;

export function replyMail(
  e: Evaluation,
  v: Pick<Evaluator, "name">,
  body: string,
  link: string,
  opts: { kind?: "question"; subject?: string } = {},
): EmailTemplate {
  if (opts.kind === "question")
    return {
      subject: opts.subject ?? `${head(e)} 확인 요청`,
      body: `${v.name} 위원님께\n\n아래 사항을 확인하시어 회신 부탁드립니다.\n\n${body}\n\n▶ 답변하기: ${link}\n(링크에서 '담당자와의 대화'에 답변을 남겨 주십시오.)${sign(e)}`,
    };
  return {
    subject: opts.subject ?? `${head(e)} 담당자 안내`,
    body: `${v.name} 위원님께\n\n${body}\n\n추가 문의나 회신은 아래 개인 링크에서 하실 수 있습니다.\n▶ ${link}${sign(e)}`,
  };
}

export function announcementMail(e: Evaluation, v: Pick<Evaluator, "name">, title: string, body: string, link: string, askReply = false): EmailTemplate {
  return {
    subject: `${head(e)} ${askReply ? "확인 요청" : "안내"}: ${title}`,
    body: `${v.name} 위원님께\n\n「${e.name}」 관련 ${askReply ? "확인 요청드릴 사항이 있습니다" : "안내사항을 알려드립니다"}.\n\n■ ${title}\n${body}\n\n${askReply ? "▶ 답변하기" : "문의·회신"}: ${link}${sign(e)}`,
  };
}

export function adminNotifyMail(e: Evaluation, v: Pick<Evaluator, "name" | "org">, body: string, adminLink: string, isAnswer = false): EmailTemplate {
  return {
    subject: `[${isAnswer ? "확인 요청 답변" : "문의 접수"}] ${e.name} - ${v.name} 위원`,
    body: `${v.name}(${v.org || "소속 미입력"}) 위원이 ${isAnswer ? "확인 요청에 답변했습니다" : "문의를 남겼습니다"}.\n\n${body}\n\n확인하기: ${adminLink}`,
  };
}

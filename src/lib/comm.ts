// 위원 소통: 1:1 문의·답변 스레드, 전체/대상별 안내사항
import { kv } from "./store";
import { AppError, getEvaluation, getEvaluator, K, listInvites, resolveToken, updateWithRetry } from "./repo";
import { adminNotifyMail, announcementMail, deliver, replyMail } from "./email";
import { pendingQuestion, type Announcement, type AnnouncementAudience, type AnnouncementDoc, type Evaluator, type Message, type Thread } from "./types";
import { newId, nowIso } from "./util";
import { audienceOfClient as audienceOf } from "./summary";

const MAX_MESSAGES = 60;
const MIN_INTERVAL_MS = 5000;

async function ensureThread(evalId: string, evaluatorId: string): Promise<void> {
  const now = nowIso();
  const t: Thread = {
    evaluationId: evalId,
    evaluatorId,
    messages: [],
    unreadAdmin: 0,
    unreadEvaluator: 0,
    lastAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  if (await kv().setnx(K.thread(evalId, evaluatorId), t)) await kv().sadd(K.threads(evalId), evaluatorId);
}

export async function getThread(evalId: string, evaluatorId: string): Promise<Thread | null> {
  return kv().get<Thread>(K.thread(evalId, evaluatorId));
}

export async function listThreads(evalId: string): Promise<Thread[]> {
  const ids = await kv().smembers(K.threads(evalId));
  const items = (await kv().mget<Thread>(ids.map((v) => K.thread(evalId, v)))).filter(Boolean) as Thread[];
  return items.filter((t) => t.messages.length).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function unreadTotal(evalIds: string[]) {
  const per = await Promise.all(evalIds.map(async (id) => [id, (await listThreads(id)).reduce((n, t) => n + t.unreadAdmin, 0)] as const));
  return Object.fromEntries(per) as Record<string, number>;
}

function append(t: Thread, msg: Message): Thread {
  if (t.messages.length >= MAX_MESSAGES) throw new AppError(400, "대화가 너무 길어 더 이상 남길 수 없습니다. 담당자에게 직접 연락해 주십시오.");
  return {
    ...t,
    messages: [...t.messages, msg],
    lastAt: msg.at,
    unreadAdmin: msg.from === "evaluator" ? t.unreadAdmin + 1 : t.unreadAdmin,
    unreadEvaluator: msg.from === "admin" ? t.unreadEvaluator + 1 : t.unreadEvaluator,
  };
}

/** 평가위원 문의 (회신 링크 화면) */
export async function postEvaluatorMessage(token: string, body: string, baseUrl: string, opts: { notify?: boolean } = {}) {
  const { evaluation, evaluator, invite } = await resolveToken(token);
  if (invite.status === "withdrawn") throw new AppError(403, "초청이 철회되어 문의를 남길 수 없습니다. 담당자에게 직접 연락해 주십시오.");
  await ensureThread(evaluation.id, evaluator.id);
  const wasAnswer = Boolean(pendingQuestion(await getThread(evaluation.id, evaluator.id)));
  const msg: Message = { id: newId("m_"), from: "evaluator", body, at: nowIso() };
  const t = await updateWithRetry<Thread>(
    K.thread(evaluation.id, evaluator.id),
    (cur) => {
      // 연속 전송만 제한 (담당자 메시지 이후의 답변은 바로 허용)
      const last = cur.messages.at(-1);
      if (last?.from === "evaluator" && Date.now() - new Date(last.at).getTime() < MIN_INTERVAL_MS)
        throw new AppError(429, "방금 보내신 메시지가 접수되었습니다. 5초 후에 다시 보내 주십시오.");
      return append(cur, msg);
    },
    "문의",
  );
  // 담당자 알림 메일 (설정된 경우)
  const notifyTo = process.env.ADMIN_NOTIFY_EMAIL;
  if (notifyTo && opts.notify !== false)
    await deliver(
      notifyTo,
      adminNotifyMail(evaluation, evaluator, body, `${baseUrl}/admin/messages?e=${evaluation.id}&v=${evaluator.id}`, wasAnswer),
    );
  return t;
}

/** 위원이 회신 화면을 열면 관리자 메시지를 읽음 처리 */
export async function markReadByEvaluator(evalId: string, evaluatorId: string) {
  const t = await getThread(evalId, evaluatorId);
  if (!t || t.unreadEvaluator === 0) return t;
  return updateWithRetry<Thread>(K.thread(evalId, evaluatorId), (cur) => ({ ...cur, unreadEvaluator: 0 }), "문의");
}

export async function markReadByAdmin(evalId: string, evaluatorId: string) {
  const t = await getThread(evalId, evaluatorId);
  if (!t || t.unreadAdmin === 0) return t;
  return updateWithRetry<Thread>(K.thread(evalId, evaluatorId), (cur) => ({ ...cur, unreadAdmin: 0 }), "문의");
}

/** 관리자 답변·개별 안내 → 홈페이지에 게시 + (선택) 메일 발송 */
export async function postAdminMessage(
  evalId: string,
  evaluatorId: string,
  body: string,
  sendEmail: boolean,
  baseUrl: string,
  opts: { kind?: "question"; subject?: string } = {},
) {
  const [evaluation, evaluator, invites] = await Promise.all([getEvaluation(evalId), getEvaluator(evaluatorId), listInvites(evalId)]);
  const inv = invites.find((i) => i.evaluatorId === evaluatorId);
  if (!inv) throw new AppError(404, "이 평가에 초청된 위원이 아닙니다.");
  const email = sendEmail
    ? await deliver(evaluator.email, replyMail(evaluation, evaluator, body, `${baseUrl}/r/${inv.token}`, opts))
    : ({ status: "skipped", detail: "메일 발송 안 함" } as const);
  await ensureThread(evalId, evaluatorId);
  const msg: Message = { id: newId("m_"), from: "admin", body, at: nowIso(), email, ...(opts.kind ? { kind: opts.kind } : {}) };
  // 답변하면 해당 위원의 미확인 문의는 읽음 처리
  const t = await updateWithRetry<Thread>(K.thread(evalId, evaluatorId), (cur) => ({ ...append(cur, msg), unreadAdmin: 0 }), "문의");
  return { thread: t, email, link: `${baseUrl}/r/${inv.token}` };
}

// ---------------- 안내사항 ----------------

export async function listAnnouncements(evalId: string): Promise<Announcement[]> {
  return (await kv().get<AnnouncementDoc>(K.announcements(evalId)))?.items ?? [];
}

export { audienceOf };

export async function createAnnouncement(
  evalId: string,
  input: { title: string; body: string; audience: AnnouncementAudience; sendEmail: boolean; askReply?: boolean },
  baseUrl: string,
) {
  const [evaluation, invites] = await Promise.all([getEvaluation(evalId), listInvites(evalId)]);
  const targets = audienceOf(invites, input.audience);
  if (!targets.length) throw new AppError(400, "안내를 받을 위원이 없습니다.");
  const evaluators = (await kv().mget<Evaluator>(targets.map((t) => K.evaluator(t.evaluatorId)))) as (Evaluator | null)[];
  const result = { sent: 0, failed: 0, skipped: 0 };
  const failures: { name: string; detail?: string; link: string; email: string }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const v = evaluators[i];
    if (!v) continue;
    const link = `${baseUrl}/r/${targets[i].token}`;
    if (!input.sendEmail) {
      result.skipped++;
      continue;
    }
    const r = await deliver(v.email, announcementMail(evaluation, v, input.title, input.body, link, input.askReply));
    result[r.status]++;
    if (r.status !== "sent") failures.push({ name: v.name, detail: r.detail, link, email: v.email });
  }
  // 답변 요청: 각 위원 대화에 확인 요청으로 남겨 위원 화면에서 답변받고 관리자 화면에서 확인
  if (input.askReply) {
    for (const t of targets) {
      await ensureThread(evalId, t.evaluatorId);
      const msg: Message = { id: newId("m_"), from: "admin", kind: "question", body: `[${input.title}]\n${input.body}`, at: nowIso(), email: { status: input.sendEmail ? "sent" : "skipped", detail: "안내사항과 함께 발송" } };
      await updateWithRetry<Thread>(K.thread(evalId, t.evaluatorId), (cur) => append(cur, msg), "문의");
    }
  }
  const a: Announcement = {
    id: newId("a_"),
    title: input.title,
    body: input.body,
    audience: input.audience,
    recipientIds: targets.map((t) => t.evaluatorId),
    at: nowIso(),
    sendEmail: input.sendEmail,
    askReply: Boolean(input.askReply),
    result,
  };
  const now = nowIso();
  await kv().setnx<AnnouncementDoc>(K.announcements(evalId), { items: [], createdAt: now, updatedAt: now, version: 1 });
  await updateWithRetry<AnnouncementDoc>(K.announcements(evalId), (cur) => ({ ...cur, items: [a, ...cur.items].slice(0, 100) }), "안내");
  return { announcement: a, failures };
}

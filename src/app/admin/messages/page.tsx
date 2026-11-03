"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import { ConditionAnswer } from "@/components/ConditionReview";
import { api, errMsg, useConfirm, useToast } from "@/components/ui";
import { announcementMail, mailtoUrl, replyMail } from "@/lib/email";
import { audienceOfClient } from "@/lib/summary";
import {
  AUDIENCE_LABEL,
  DISPLAY_STATE_LABEL,
  inviteDisplayState,
  type Announcement,
  type AnnouncementAudience,
  type MailResult,
  type Thread,
  pendingQuestion,
  unansweredInquiry,
} from "@/lib/types";
import { formatDateTime } from "@/lib/util";

const MAIL_BADGE: Record<MailResult["status"], [string, string]> = {
  sent: ["메일 발송됨", "ok"],
  failed: ["메일 발송 실패", "bad"],
  skipped: ["메일 미발송", ""],
};

function Conversation({
  evaluation,
  evaluatorId,
  onChanged,
}: {
  evaluation: EvalWithCounts;
  evaluatorId: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { meta } = useAdmin();
  const { invites, byId, reload: reloadData } = useEvalData(evaluation.id);
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [mode, setMode] = useState<"reply" | "question">("reply");
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<{ href: string; reason?: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const v = byId.get(evaluatorId);
  const inv = invites?.find((i) => i.evaluatorId === evaluatorId);

  const load = useCallback(async () => {
    const r = await api<{ thread: Thread | null }>(`/api/admin/evaluations/${evaluation.id}/messages/${evaluatorId}`);
    setThread(r.thread);
    if (r.thread?.unreadAdmin) {
      await api(`/api/admin/evaluations/${evaluation.id}/messages/${evaluatorId}`, { method: "POST", json: { read: true } });
      onChanged();
    }
  }, [evaluation.id, evaluatorId, onChanged]);

  useEffect(() => {
    setFallback(null);
    setText("");
    load().catch((e) => toast(errMsg(e), "bad"));
  }, [load, toast]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.messages.length]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setFallback(null);
    try {
      const r = await api<{ thread: Thread; email: MailResult; link: string }>(`/api/admin/evaluations/${evaluation.id}/messages/${evaluatorId}`, {
        method: "POST",
        json: { body: text, sendEmail, kind: mode },
      });
      setThread(r.thread);
      const what = mode === "question" ? "확인 요청" : "답변";
      if (r.email.status === "sent") toast(`${what}을 게시하고 메일로 보냈습니다.`, "ok");
      else if (sendEmail && v?.email) {
        setFallback({ href: mailtoUrl(v.email, replyMail(evaluation, v, text, r.link, mode === "question" ? { kind: "question" } : {})), reason: r.email.detail });
        toast(`${what}을 게시했습니다. 메일은 직접 보내 주세요.`, "info");
      } else toast(`${what}을 위원 회신 화면에 게시했습니다.`, "ok");
      setText("");
      onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  if (!v) return <div className="empty">불러오는 중…</div>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between">
        <div>
          <h2>{v.name} <span className="muted small">{v.org}</span></h2>
          <div className="small muted">
            {v.email || "이메일 미등록"} {inv && <>· <span className="badge">{DISPLAY_STATE_LABEL[inviteDisplayState(inv)]}</span></>}
          </div>
        </div>
        {inv && <a className="btn sm" href={`/r/${inv.token}`} target="_blank" rel="noreferrer">위원 화면 보기 ↗</a>}
      </div>
      <div className="thread">
        {!thread?.messages.length && <div className="empty small">아직 주고받은 메시지가 없습니다. 이 위원에게 개별 안내를 보낼 수 있습니다.</div>}
        {thread?.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.from}`}>
            <div className="bubble-meta">
              {m.from === "admin" ? (m.kind === "question" ? "담당자 확인 요청" : "담당자") : v.name} · {formatDateTime(m.at)}
              {m.kind === "condition" && <span className="badge warn">조건부 참석 문의</span>}
              {m.kind === "question" && (pendingQuestion(thread)?.id === m.id ? <span className="badge warn">답변 대기</span> : <span className="badge ok">답변 받음</span>)}
              {m.email && m.from === "admin" && (
                <span className={`badge ${MAIL_BADGE[m.email.status][1]}`} title={m.email.detail}>{MAIL_BADGE[m.email.status][0]}</span>
              )}
            </div>
            <div className="bubble-body">{m.body}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {inv && inv.response?.attendance === "conditional" && !inv.conditionReview && evaluation.status !== "finalized" && (
        <div className="decision-bar">
          <b>조건부 참석 문의에 답변하고 수락 여부를 정해 주세요</b>
          <ConditionAnswer
            compact
            evaluation={evaluation}
            invite={inv}
            evaluator={v}
            onDone={() => {
              reloadData();
              load();
            }}
          />
        </div>
      )}
      <div className="stack" style={{ gap: 8 }}>
        <div className="seg" role="radiogroup" aria-label="보낼 내용 종류">
          <button className={mode === "reply" ? "on" : ""} onClick={() => setMode("reply")} role="radio" aria-checked={mode === "reply"}>답변·안내</button>
          <button className={mode === "question" ? "on" : ""} onClick={() => setMode("question")} role="radio" aria-checked={mode === "question"}>확인 요청 (답변 받기)</button>
        </div>
        <textarea className="textarea" placeholder={mode === "question" ? "위원에게 확인할 사항을 적어 주세요. 위원이 회신 화면에서 답하면 여기에 표시됩니다." : "답변 또는 개별 안내 내용을 입력하세요. 위원의 회신 화면에 게시됩니다."} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} aria-label="답변 내용" />
        <div className="row between">
          <label className="row small">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            위원에게 메일로도 보내기 {!meta?.email.configured && <span className="faint">(발송 서비스 미설정: 메일 앱으로 열기 제공)</span>}
          </label>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={send}>{busy ? "보내는 중…" : mode === "question" ? "확인 요청 보내기" : "답변 보내기"}</button>
        </div>
        {fallback && (
          <div className="notice warn row between">
            <span>메일이 자동 발송되지 않았습니다{fallback.reason ? ` (${fallback.reason})` : ""}. 업무용 메일로 직접 보내 주세요.</span>
            <a className="btn sm" href={fallback.href}>메일 앱으로 열기</a>
          </div>
        )}
      </div>
    </div>
  );
}

function Announcements({ evaluation, items, onChanged }: { evaluation: EvalWithCounts; items: Announcement[]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { invites, byId } = useEvalData(evaluation.id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("all");
  const [sendEmail, setSendEmail] = useState(true);
  const [askReply, setAskReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<{ name: string; detail?: string; link: string; email: string }[]>([]);
  const [lastSent, setLastSent] = useState({ title: "", body: "" });
  const targets = useMemo(() => audienceOfClient(invites ?? [], audience), [invites, audience]);

  async function send() {
    const ok = await confirm({
      title: "안내사항 보내기",
      confirmText: "보내기",
      message: `${AUDIENCE_LABEL[audience]} ${targets.length}명에게 안내를 게시${sendEmail ? "하고 메일로 발송" : ""}합니다.`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ announcement: Announcement; failures: typeof failures }>(`/api/admin/evaluations/${evaluation.id}/announcements`, {
        method: "POST",
        json: { title, body, audience, sendEmail, askReply },
      });
      const res = r.announcement.result;
      toast(`${r.announcement.recipientIds.length}명에게 게시했습니다. 메일 발송 ${res.sent}건${res.failed ? ` · 실패 ${res.failed}건` : ""}${sendEmail && res.skipped ? ` · 미발송 ${res.skipped}건` : ""}`, res.failed ? "bad" : "ok");
      setFailures(sendEmail ? r.failures : []);
      setLastSent({ title, body });
      setTitle("");
      setBody("");
      onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="card-head"><h2>새 안내사항</h2></div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <div className="field">
            <label>받는 위원</label>
            <select className="select" value={audience} onChange={(e) => setAudience(e.target.value as AnnouncementAudience)}>
              {(Object.keys(AUDIENCE_LABEL) as AnnouncementAudience[]).map((k) => (
                <option key={k} value={k}>{AUDIENCE_LABEL[k]} ({audienceOfClient(invites ?? [], k).length}명)</option>
              ))}
            </select>
            <span className="hint">{targets.map((t) => byId.get(t.evaluatorId)?.name).filter(Boolean).join(", ") || "대상 없음"}</span>
          </div>
          <div className="field"><label>제목</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 사전 검토자료 송부 안내" maxLength={120} /></div>
          <div className="field"><label>내용</label><textarea className="textarea" style={{ minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} /></div>
          <label className="row small"><input type="checkbox" checked={askReply} onChange={(e) => setAskReply(e.target.checked)} /> 답변 요청 (위원별 대화에 확인 요청으로 남기고, 답변을 받아 확인)</label>
          <label className="row small"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> 메일로도 발송 (회신 화면에는 항상 게시)</label>
          <button className="btn primary" disabled={busy || !title.trim() || !body.trim() || !targets.length} onClick={send}>{busy ? "보내는 중…" : `${targets.length}명에게 보내기`}</button>
          {failures.length > 0 && (
            <div className="notice warn stack" style={{ gap: 6 }}>
              <b>메일이 자동 발송되지 않은 위원 ({failures.length}명) — 수동 발송이 필요합니다</b>
              {failures.map((f) => (
                <div key={f.link} className="row between small">
                  <span>{f.name} <span className="faint">({f.detail})</span></span>
                  {f.email && <a className="btn sm" href={mailtoUrl(f.email, announcementMail(evaluation, { name: f.name }, lastSent.title, lastSent.body, f.link))}>메일 앱으로 열기</a>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>보낸 안내 ({items.length})</h2></div>
        {items.length === 0 ? (
          <div className="empty small">보낸 안내가 없습니다.</div>
        ) : (
          <div className="card-body stack">
            {items.map((a) => (
              <div key={a.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                <div className="row between">
                  <b>{a.title}</b>
                  <span className="small muted">{formatDateTime(a.at)}</span>
                </div>
                <div className="small muted" style={{ margin: "2px 0 6px" }}>
                  {a.askReply && <span className="badge warn" style={{ marginRight: 6 }}>답변 요청</span>}{AUDIENCE_LABEL[a.audience]} {a.recipientIds.length}명 · {a.sendEmail ? `메일 발송 ${a.result.sent} / 실패 ${a.result.failed} / 미발송 ${a.result.skipped}` : "게시만"}
                </div>
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>{a.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Messages({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell } = useAdmin();
  const search = useSearchParams();
  const { invites, byId } = useEvalData(evaluation.id);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [tab, setTab] = useState<"inbox" | "announce">("inbox");
  const [selected, setSelected] = useState<string | null>(search.get("v"));
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ threads: Thread[]; announcements: Announcement[] }>(`/api/admin/evaluations/${evaluation.id}/messages`);
    setThreads(r.threads);
    setAnnouncements(r.announcements);
  }, [evaluation.id]);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15000);
    return () => clearInterval(t);
  }, [load]);
  const changed = useCallback(() => {
    load();
    reloadShell();
  }, [load, reloadShell]);

  const tmap = new Map(threads.map((t) => [t.evaluatorId, t]));
  const people = (invites ?? [])
    .filter((i) => {
      const v = byId.get(i.evaluatorId);
      return !q || (v && [v.name, v.org].some((s) => s.includes(q)));
    })
    .sort((a, b) => {
      const ta = tmap.get(a.evaluatorId), tb = tmap.get(b.evaluatorId);
      return (tb?.unreadAdmin ?? 0) - (ta?.unreadAdmin ?? 0) || (tb?.lastAt ?? "").localeCompare(ta?.lastAt ?? "");
    });
  const unread = threads.reduce((n, t) => n + t.unreadAdmin, 0);
  // 처음 열면 확인이 필요한 위원(새 문의 → 미답변)을 자동으로 선택
  useEffect(() => {
    if (selected || !threads.length) return;
    const t = threads.find((x) => x.unreadAdmin) ?? threads.find((x) => unansweredInquiry(x));
    if (t) setSelected(t.evaluatorId);
  }, [threads, selected]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>위원 문의·안내</h1>
          <p>위원 문의에 답하고, 확인할 사항을 물어 답변을 받습니다. 보낸 내용은 위원 회신 화면에 게시되고 메일로도 갑니다.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>위원 문의 {unread > 0 && <span className="badge bad">{unread}</span>}</button>
        <button className={`tab ${tab === "announce" ? "active" : ""}`} onClick={() => setTab("announce")}>전체·대상별 안내</button>
      </div>
      {tab === "announce" ? (
        <Announcements evaluation={evaluation} items={announcements} onChanged={changed} />
      ) : !invites?.length ? (
        <div className="card"><div className="empty">초청한 위원이 없습니다.</div></div>
      ) : (
        <div className="msg-layout">
          <div className="card msg-list">
            <div className="card-head"><input className="input" placeholder="이름·소속 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="위원 검색" /></div>
            {people.map((i) => {
              const v = byId.get(i.evaluatorId);
              const t = tmap.get(i.evaluatorId);
              const last = t?.messages.at(-1);
              return (
                <button key={i.evaluatorId} className={`msg-item ${selected === i.evaluatorId ? "on" : ""}`} onClick={() => setSelected(i.evaluatorId)}>
                  <div className="row between">
                    <b>{v?.name}</b>
                    {t?.unreadAdmin ? (
                      <span className="badge bad">
                        {last?.kind === "condition" ? "조건부 문의" : t.messages.some((m) => m.kind === "question") && last?.from === "evaluator" ? "답변 도착" : "새 문의"} {t.unreadAdmin}
                      </span>
                    ) : pendingQuestion(t) ? (
                      <span className="badge warn">답변 대기</span>
                    ) : unansweredInquiry(t) ? (
                      <span className="badge warn">미답변</span>
                    ) : last ? (
                      <span className="small faint">{formatDateTime(last.at).slice(5)}</span>
                    ) : null}
                  </div>
                  <div className="small muted msg-preview">{last ? `${last.from === "admin" ? "↳ " : ""}${last.body}` : `${v?.org ?? ""} · ${DISPLAY_STATE_LABEL[inviteDisplayState(i)]}`}</div>
                </button>
              );
            })}
          </div>
          <div className="card">
            <div className="card-body">
              {selected && invites.some((i) => i.evaluatorId === selected) ? (
                <Conversation key={selected} evaluation={evaluation} evaluatorId={selected} onChanged={changed} />
              ) : (
                <div className="empty">왼쪽에서 위원을 선택하세요. {unread > 0 && `확인하지 않은 문의가 ${unread}건 있습니다.`}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MessagesPage() {
  return (
    <NeedEvaluation>
      {(e) => (
        <Suspense>
          <Messages key={e.id} evaluation={e} />
        </Suspense>
      )}
    </NeedEvaluation>
  );
}

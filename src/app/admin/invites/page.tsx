"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import { api, copyText, errMsg, Modal, RowMenu, useConfirm, useToast } from "@/components/ui";
import { DEFAULT_TEMPLATE, mailtoUrl, PLACEHOLDERS, renderTemplate } from "@/lib/email";
import { STATE_CLASS, DISPLAY_STATE_LABEL, followupOf, inviteDisplayState, type Evaluator, type Invite } from "@/lib/types";
import { formatDateTime, recipientAllowed } from "@/lib/util";

const STATE_CLS = STATE_CLASS;

function TemplateEditor({ evaluation, sample }: { evaluation: EvalWithCounts; sample: { evaluator: Pick<Evaluator, "name" | "org">; link: string } }) {
  const { reload } = useAdmin();
  const toast = useToast();
  const [subject, setSubject] = useState(evaluation.emailTemplate.subject);
  const [body, setBody] = useState(evaluation.emailTemplate.body);
  const [focus, setFocus] = useState<"subject" | "body">("body");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjRef = useRef<HTMLInputElement>(null);
  const locked = evaluation.status === "finalized";
  const dirty = subject !== evaluation.emailTemplate.subject || body !== evaluation.emailTemplate.body;
  const preview = renderTemplate({ subject, body }, { evaluation, ...sample });

  function insert(token: string) {
    const el = focus === "subject" ? subjRef.current : bodyRef.current;
    const val = focus === "subject" ? subject : body;
    const pos = el?.selectionStart ?? val.length;
    const next = val.slice(0, pos) + `{{${token}}}` + val.slice(el?.selectionEnd ?? pos);
    if (focus === "subject") setSubject(next);
    else setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + token.length + 4, pos + token.length + 4);
    });
  }

  async function save() {
    try {
      await api(`/api/admin/evaluations/${evaluation.id}`, { method: "PATCH", json: { emailTemplate: { subject, body }, version: evaluation.version } });
      await reload();
      toast("메일 양식을 저장했습니다.", "ok");
    } catch (e) {
      toast(errMsg(e), "bad");
      reload();
    }
  }

  return (
    <div className="grid-2">
      <div className="stack" style={{ gap: 10 }}>
        <div className="field">
          <label>제목</label>
          <input ref={subjRef} className="input" value={subject} disabled={locked} onFocus={() => setFocus("subject")} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field">
          <label>본문</label>
          <textarea ref={bodyRef} className="textarea" style={{ minHeight: 300 }} value={body} disabled={locked} onFocus={() => setFocus("body")} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="row small">
          <span className="muted">자동 입력 항목:</span>
          {PLACEHOLDERS.map((p) => (
            <button key={p.key} className="chip" title={p.desc} disabled={locked} onClick={() => insert(p.key)}>
              {p.key}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={save} disabled={!dirty || locked || !subject.trim() || !body.trim()}>양식 저장</button>
          <button className="btn" disabled={locked} onClick={() => { setSubject(DEFAULT_TEMPLATE.subject); setBody(DEFAULT_TEMPLATE.body); }}>기본 양식 불러오기</button>
          {!body.includes("{{회신링크}}") && <span className="badge bad">본문에 {"{{회신링크}}"}가 없습니다</span>}
        </div>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="small muted">미리보기 ({sample.evaluator.name} 위원 기준)</div>
        <div className="strong">{preview.subject}</div>
        <div className="preview-mail">{preview.body}</div>
      </div>
    </div>
  );
}

function InviteDialog({
  evaluation,
  invite,
  evaluator,
  onClose,
  onChanged,
}: {
  evaluation: EvalWithCounts;
  invite: Invite;
  evaluator: Evaluator;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { meta } = useAdmin();
  const toast = useToast();
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const link = `${window.location.origin}/r/${invite.token}`;
  const mail = renderTemplate(evaluation.emailTemplate, { evaluation, evaluator, link });
  const locked = evaluation.status === "finalized";
  const canDirect = !!evaluator.email && !!meta?.email.configured && recipientAllowed(evaluator.email, meta.email.allowList);

  async function action(json: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      await api(`/api/admin/evaluations/${evaluation.id}/invites/${invite.evaluatorId}`, { method: "POST", json });
      toast(msg, "ok");
      onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  async function sendEmail(mode: "test" | "direct") {
    setBusy(true);
    try {
      const r = await api<{ to: string }>(`/api/admin/evaluations/${evaluation.id}/invites/${invite.evaluatorId}/email`, {
        method: "POST",
        json: mode === "test" ? { mode, to: testTo } : { mode },
      });
      toast(`${r.to} 으로 ${mode === "test" ? "시험 " : ""}발송했습니다.`, "ok");
      if (mode === "direct") onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={`초청 메일 — ${evaluator.name} (${evaluator.org || "소속 미입력"})`}
      onClose={onClose}
      footer={
        <>
          <a className="btn" href={link} target="_blank" rel="noreferrer">회신 화면 열어보기 ↗</a>
          <span className="spacer" />
          {invite.status === "pending" && !locked && (
            <button className="btn primary" disabled={busy} onClick={() => action({ type: "markSent" }, "발송 완료로 표시했습니다.")}>발송 완료 표시</button>
          )}
          <button className="btn" onClick={onClose}>닫기</button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-2">
          <div className="stack" style={{ gap: 6 }}>
            <div><span className="muted">받는 사람</span> {evaluator.email || <span className="badge bad">이메일 미등록</span>}</div>
            <div><span className="muted">제목</span> <b>{mail.subject}</b></div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", alignContent: "start" }}>
            {evaluator.email && <a className={`btn ${meta?.email.configured ? "" : "primary"}`} href={mailtoUrl(evaluator.email, mail)}>업무용 메일 앱으로 열기</a>}
            <button className="btn" onClick={async () => (await copyText(mail.subject)) && toast("제목을 복사했습니다.", "ok")}>제목 복사</button>
            <button className="btn" onClick={async () => (await copyText(mail.body)) && toast("본문을 복사했습니다.", "ok")}>본문 복사</button>
            <button className="btn" onClick={async () => (await copyText(link)) && toast("회신 링크를 복사했습니다.", "ok")}>링크 복사</button>
          </div>
        </div>
        <div className="preview-mail">{mail.body}</div>
        <div className="small muted">
          {meta?.email.configured
            ? "아래 '위원에게 메일 보내기'를 누르면 바로 발송되고 발송 완료로 기록됩니다. 업무용 메일 앱으로 보낸 경우에는 '발송 완료 표시'를 눌러 주세요."
            : "기존 업무용 이메일로 발송한 뒤 '발송 완료 표시'를 눌러 주세요. 평가위원이 링크로 회신하면 자동으로 발송된 것으로 처리됩니다."}
        </div>

        <div className="card">
          <div className="card-body stack" style={{ gap: 10 }}>
            <div className="row between">
              <h3>시스템에서 바로 보내기</h3>
              <span className={`badge ${meta?.email.configured ? "ok" : ""}`}>
                {meta?.email.configured ? `보내는 주소 ${meta.email.from}` : "메일 설정 전"}
              </span>
            </div>
            {meta?.email.configured ? (
              <>
                <div className="row">
                  <button className="btn primary" disabled={busy || !canDirect || locked || invite.status === "withdrawn"} onClick={() => sendEmail("direct")}>
                    {evaluator.name} 위원에게 메일 보내기
                  </button>
                  {!evaluator.email ? (
                    <span className="small muted">위원 이메일이 없습니다.</span>
                  ) : !canDirect ? (
                    <span className="small" style={{ color: "var(--warn)" }}>발송 허용 주소가 아닙니다. <a href="/admin/settings">메일 설정</a>에서 허용 주소를 확인해 주세요.</span>
                  ) : null}
                </div>
                <div className="row">
                  <input className="input" style={{ maxWidth: 260 }} placeholder="내 메일 주소로 미리 받아 보기" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="시험 수신 주소" />
                  <button className="btn" disabled={busy || !testTo} onClick={() => sendEmail("test")}>시험 발송</button>
                </div>
              </>
            ) : (
              <p className="small muted">
                메일 계정(네이버·Gmail·기관 메일)을 연결하면 이 화면에서 바로 보낼 수 있습니다. <a href="/admin/settings">메일 설정 안내</a>
              </p>
            )}
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 6 }}>처리 이력</h3>
          <table className="table">
            <tbody>
              {invite.log.map((l, i) => (
                <tr key={i}>
                  <td className="small nowrap muted" style={{ width: 150 }}>{formatDateTime(l.at)}</td>
                  <td className="small">{l.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function timeLeft(inv: Invite, hours: number, now: number) {
  if (inv.status !== "sent" || inv.response || !inv.sentAt) return null;
  const ms = new Date(inv.sentAt).getTime() + hours * 3600 * 1000 - now;
  if (ms <= 0) return { overdue: true, label: "회신 기한 경과" };
  const h = Math.floor(ms / 3600000);
  return { overdue: false, label: h >= 1 ? `자동 후속까지 ${h}시간` : `자동 후속까지 ${Math.max(1, Math.round(ms / 60000))}분` };
}

function FollowupBanner({ evaluation, onRan }: { evaluation: EvalWithCounts; onRan: () => void }) {
  const { meta } = useAdmin();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const f = followupOf(evaluation);
  if (evaluation.status === "finalized") return null;
  async function run() {
    setBusy(true);
    try {
      const r = await api<{ results: { invited: { name: string; sent: boolean; detail?: string }[]; note?: string }[] }>("/api/admin/followup", {
        method: "POST",
        json: { evaluationId: evaluation.id },
      });
      const res = r.results[0];
      if (!res) toast("지금 처리할 무응답·불참 위원이 없습니다.", "info");
      else if (res.invited.length) toast(`다음 순위 ${res.invited.length}명 안내: ${res.invited.map((i) => `${i.name}${i.sent ? "(메일 발송)" : "(발송 필요)"}`).join(", ")}`, "ok");
      else toast(res.note ?? "처리했습니다.", "info");
      onRan();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`notice ${f.enabled ? "" : "warn"} row between`}>
      <span>
        {f.enabled ? (
          <>
            <b>자동 후속 안내 사용 중</b> — 발송 후 <b>{f.hours}시간</b> 안에 회신이 없으면{f.onDecline ? " (또는 참석 불가 회신 시)" : ""} 다음 순위 위원을 자동 초청
            {f.autoSend ? (meta?.email.configured ? "하고 메일을 발송합니다." : "합니다. (메일 설정 전이라 초청 대상만 추가, 메일은 직접 발송)") : "합니다. (메일은 직접 발송)"}
          </>
        ) : (
          <>자동 후속 안내가 꺼져 있습니다. 평가 등록 화면의 평가 수정에서 평가별로 설정할 수 있습니다.</>
        )}
      </span>
      {f.enabled && <button className="btn sm" disabled={busy} onClick={run}>{busy ? "점검 중…" : "지금 점검"}</button>}
    </div>
  );
}

function Invites({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell, meta } = useAdmin();
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<{ name: string; status: "sent" | "failed" | "skipped"; detail?: string }[] | null>(null);
  const fu = followupOf(evaluation);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const toast = useToast();
  const confirm = useConfirm();
  const { invites, byId, reload, ready } = useEvalData(evaluation.id);
  const [open, setOpen] = useState<string | null>(null);
  const [showTpl, setShowTpl] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const locked = evaluation.status === "finalized";

  const refresh = async () => {
    await Promise.all([reload(), reloadShell()]);
  };

  async function action(inv: Invite, json: Record<string, unknown>, msg: string) {
    try {
      await api(`/api/admin/evaluations/${evaluation.id}/invites/${inv.evaluatorId}`, { method: "POST", json });
      toast(msg, "ok");
      await refresh();
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  }

  async function withdraw(inv: Invite) {
    const v = byId.get(inv.evaluatorId);
    const reason = await confirm({
      title: "섭외 철회",
      message: `${v?.name} 위원의 섭외를 철회합니다. 철회 후에는 회신 링크로 응답할 수 없습니다.`,
      confirmText: "철회",
      danger: true,
      input: { label: "철회 사유 (선택)", placeholder: "예) 일정 조정 불가, 이해관계 확인" },
    });
    if (reason === false) return;
    await action(inv, { type: "withdraw", reason: reason === "ok" ? "" : reason }, "섭외를 철회했습니다.");
  }

  async function bulkEmail() {
    const ids = (invites ?? []).filter((i) => checked.has(i.evaluatorId) && i.status !== "withdrawn").map((i) => i.evaluatorId);
    const ok = await confirm({
      title: "초청 메일 보내기",
      confirmText: "보내기",
      message: `선택한 ${ids.length}명에게 초청 메일을 보냅니다. 이미 보낸 위원에게는 다시 발송됩니다.`,
    });
    if (!ok) return;
    setSending(true);
    try {
      const r = await api<{ results: NonNullable<typeof sendResults> }>(`/api/admin/evaluations/${evaluation.id}/invites/send`, {
        method: "POST",
        json: { evaluatorIds: ids },
      });
      const sent = r.results.filter((x) => x.status === "sent").length;
      toast(`초청 메일 ${sent}건을 보냈습니다.${r.results.length - sent ? ` 보내지 못한 위원 ${r.results.length - sent}명` : ""}`, sent === r.results.length ? "ok" : "bad");
      setSendResults(r.results.filter((x) => x.status !== "sent"));
      setChecked(new Set());
      await refresh();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setSending(false);
    }
  }

  async function bulkSent() {
    const targets = (invites ?? []).filter((i) => checked.has(i.evaluatorId) && i.status === "pending");
    for (const inv of targets) {
      await api(`/api/admin/evaluations/${evaluation.id}/invites/${inv.evaluatorId}`, { method: "POST", json: { type: "markSent" } }).catch(() => null);
    }
    setChecked(new Set());
    toast(`${targets.length}명을 발송 완료로 표시했습니다.`, "ok");
    await refresh();
  }

  const sample = useMemo(() => {
    const first = invites?.[0];
    const v = first ? byId.get(first.evaluatorId) : undefined;
    return { evaluator: v ?? { name: "홍길동", org: "가상대학교" }, link: `${typeof window !== "undefined" ? window.location.origin : ""}/r/${first?.token ?? "(위원별 고유 링크)"}` };
  }, [invites, byId]);

  const openInv = invites?.find((i) => i.evaluatorId === open);
  const openEv = openInv ? byId.get(openInv.evaluatorId) : undefined;
  const pendingChecked = (invites ?? []).filter((i) => checked.has(i.evaluatorId) && i.status === "pending").length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>초청 메일</h1>
          <p>위원마다 개인 회신 링크가 담긴 메일을 보내고, 발송 상태를 확인합니다.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowTpl((s) => !s)}>{showTpl ? "메일 양식 닫기" : "메일 양식 편집"}</button>
          <Link className="btn" href={`/admin/responses?e=${evaluation.id}`}>회신 현황 보기</Link>
        </div>
      </div>

      <FollowupBanner evaluation={evaluation} onRan={refresh} />

      {sendResults && sendResults.length > 0 && (
        <div className="notice warn stack" style={{ gap: 4 }}>
          <div className="row between"><b>메일을 보내지 못한 위원 ({sendResults.length}명)</b><button className="btn sm ghost" onClick={() => setSendResults(null)}>닫기</button></div>
          {sendResults.map((r) => <div key={r.name} className="small">{r.name}: {r.detail}</div>)}
          <div className="small muted">&lsquo;메일 보내기&rsquo;를 눌러 메일 앱으로 직접 보내실 수 있습니다.</div>
        </div>
      )}

      {showTpl && (
        <div className="card">
          <div className="card-head"><h2>초청 메일 양식</h2><span className="small muted">평가별로 저장됩니다</span></div>
          <div className="card-body"><TemplateEditor key={evaluation.version} evaluation={evaluation} sample={sample} /></div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>초청 대상 {invites ? `(${invites.length}명)` : ""}</h2>
          <div className="row">
            {checked.size > 0 && !locked && meta?.email.configured && (
              <button className="btn sm primary" disabled={sending} onClick={bulkEmail}>{sending ? "보내는 중…" : `선택한 ${checked.size}명에게 메일 보내기`}</button>
            )}
            {pendingChecked > 0 && !locked && <button className="btn sm" onClick={bulkSent}>선택한 {pendingChecked}명 발송 완료 표시</button>}
            <Link className="btn sm" href={`/admin/priority?e=${evaluation.id}`}>+ 초청 대상 추가</Link>
          </div>
        </div>
        {!ready ? (
          <div className="empty">불러오는 중…</div>
        ) : !invites?.length ? (
          <div className="empty">
            아직 초청 대상이 없습니다. <Link href={`/admin/priority?e=${evaluation.id}`}>우선순위·섭외</Link>에서 대상을 선정하세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={invites.length > 0 && invites.every((i) => checked.has(i.evaluatorId))}
                      onChange={(e) => setChecked(e.target.checked ? new Set(invites.map((i) => i.evaluatorId)) : new Set())}
                    />
                  </th>
                  <th>위원</th><th>상태</th><th>발송</th><th>최근 처리</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const v = byId.get(inv.evaluatorId);
                  const st = inviteDisplayState(inv);
                  return (
                    <tr key={inv.evaluatorId} className={st === "withdrawn" ? "dim" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${v?.name} 선택`}
                          checked={checked.has(inv.evaluatorId)}
                          onChange={() =>
                            setChecked((s) => {
                              const n = new Set(s);
                              if (n.has(inv.evaluatorId)) n.delete(inv.evaluatorId);
                              else n.add(inv.evaluatorId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td>
                        <div className="who">
                          <b>{v?.name ?? "(삭제됨)"} <span className="faint small" style={{ fontWeight: 400 }}>{inv.round}차</span></b>
                          <span>{v?.org}</span>
                          <span>{v?.email || <span className="badge bad">이메일 미등록</span>}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${STATE_CLS[st]}`}>{DISPLAY_STATE_LABEL[st]}</span>
                        {inv.autoInvited && <span className="badge dark" style={{ marginLeft: 4 }} title="무응답·불참에 따른 자동 후속 안내로 추가">자동</span>}
                        {(() => {
                          if (inv.escalatedAt && !inv.response) return <div className="small" style={{ color: "var(--bad)" }}>무응답 → 다음 순위 안내됨</div>;
                          if (inv.escalatedAt && inv.response) return <div className="small faint">다음 순위 안내됨</div>;
                          const tl = fu.enabled && evaluation.status !== "finalized" ? timeLeft(inv, fu.hours, now) : null;
                          return tl ? <div className="small" style={{ color: tl.overdue ? "var(--bad)" : "var(--muted)" }}>{tl.label}</div> : null;
                        })()}
                      </td>
                      <td className="small nowrap">{inv.sentAt ? `${formatDateTime(inv.sentAt)}${inv.sentVia === "email" ? " (자동)" : ""}` : "-"}</td>
                      <td className="small muted">{inv.log[0]?.action}</td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        <button className={`btn sm ${inv.status === "pending" ? "primary" : ""}`} onClick={() => setOpen(inv.evaluatorId)} disabled={!v}>
                          {inv.status === "pending" ? "메일 보내기" : "메일 보기"}
                        </button>{" "}
                        {!locked && (
                          <RowMenu
                            items={[
                              { label: "발송 완료로 표시", hidden: inv.status !== "pending", onClick: () => action(inv, { type: "markSent" }, "발송 완료로 표시했습니다.") },
                              { label: "발송 표시 취소", hidden: !(inv.status === "sent" && !inv.response), onClick: () => action(inv, { type: "unmarkSent" }, "발송 표시를 취소했습니다.") },
                              { label: "재초청", hidden: inv.status !== "withdrawn", onClick: () => action(inv, { type: "reinvite" }, "다시 초청 상태로 되돌렸습니다.") },
                              { label: "초청 대상에서 제외", hidden: inv.status !== "pending", onClick: () => action(inv, { type: "remove" }, "초청 대상에서 제외했습니다.") },
                              { label: "섭외 철회", danger: true, hidden: inv.status === "withdrawn", onClick: () => withdraw(inv) },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openInv && openEv && (
        <InviteDialog evaluation={evaluation} invite={openInv} evaluator={openEv} onClose={() => setOpen(null)} onChanged={refresh} />
      )}
    </div>
  );
}

export default function InvitesPage() {
  return <NeedEvaluation>{(e) => <Invites key={e.id} evaluation={e} />}</NeedEvaluation>;
}

"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import { api, copyText, errMsg, Modal, useConfirm, useToast } from "@/components/ui";
import { DEFAULT_TEMPLATE, mailtoUrl, PLACEHOLDERS, renderTemplate } from "@/lib/email";
import { DISPLAY_STATE_LABEL, inviteDisplayState, type Evaluator, type Invite, type InviteDisplayState } from "@/lib/types";
import { formatDateTime } from "@/lib/util";

const STATE_CLS: Record<InviteDisplayState, string> = {
  not_sent: "", waiting: "info", yes: "ok", conditional: "warn", no: "bad", withdrawn: "bad",
};

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
            {evaluator.email && <a className="btn primary" href={mailtoUrl(evaluator.email, mail)}>업무용 메일 앱으로 열기</a>}
            <button className="btn" onClick={async () => (await copyText(mail.subject)) && toast("제목을 복사했습니다.", "ok")}>제목 복사</button>
            <button className="btn" onClick={async () => (await copyText(mail.body)) && toast("본문을 복사했습니다.", "ok")}>본문 복사</button>
            <button className="btn" onClick={async () => (await copyText(link)) && toast("회신 링크를 복사했습니다.", "ok")}>링크 복사</button>
          </div>
        </div>
        <div className="preview-mail">{mail.body}</div>
        <div className="small muted">
          기존 업무용 이메일로 발송한 뒤 <b>발송 완료 표시</b>를 눌러 주세요. 평가위원이 링크로 회신하면 자동으로 발송된 것으로 처리됩니다.
        </div>

        <div className="card">
          <div className="card-body stack" style={{ gap: 10 }}>
            <div className="row between">
              <h3>외부 발송 서비스 연동 (시험 단계)</h3>
              <span className={`badge ${meta?.email.configured ? "ok" : ""}`}>{meta?.email.configured ? `연결됨 · ${meta.email.from}` : "미설정"}</span>
            </div>
            {meta?.email.configured ? (
              <>
                <div className="row">
                  <input className="input" style={{ maxWidth: 280 }} placeholder="시험 수신 주소 (본인 메일)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                  <button className="btn" disabled={busy || !testTo} onClick={() => sendEmail("test")}>시험 발송</button>
                  <button className="btn" disabled={busy || !evaluator.email || locked || invite.status === "withdrawn"} onClick={() => sendEmail("direct")} title="허용목록에 있는 주소만 발송됩니다">위원에게 직접 발송</button>
                </div>
                <p className="small muted">수신자 제한: 허용목록({meta.email.allowList.length ? meta.email.allowList.join(", ") : "비어 있음 — 직접 발송 불가"})에 있는 주소로만 발송됩니다.</p>
              </>
            ) : (
              <p className="small muted">RESEND_API_KEY, EMAIL_FROM, EMAIL_ALLOWED_RECIPIENTS 환경변수를 설정하면 시험 발송을 사용할 수 있습니다. 발신자 인증·기관 보안정책 검토 후 적용 여부를 결정하세요.</p>
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

function Invites({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell } = useAdmin();
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
          <h1>④ 초청 메일 관리</h1>
          <p>위원별 고유 회신 링크가 담긴 초청 메일을 확인·발송하고, 발송 이력과 처리 상태를 관리합니다.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowTpl((s) => !s)}>{showTpl ? "메일 양식 닫기" : "메일 양식 편집"}</button>
          <Link className="btn" href={`/admin/responses?e=${evaluation.id}`}>⑤ 회신 현황으로 →</Link>
        </div>
      </div>

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
            {pendingChecked > 0 && !locked && <button className="btn sm" onClick={bulkSent}>선택한 {pendingChecked}명 발송 완료 표시</button>}
            <Link className="btn sm" href={`/admin/priority?e=${evaluation.id}`}>+ 초청 대상 추가</Link>
          </div>
        </div>
        {!ready ? (
          <div className="empty">불러오는 중…</div>
        ) : !invites?.length ? (
          <div className="empty">
            아직 초청 대상이 없습니다. <Link href={`/admin/priority?e=${evaluation.id}`}>③ 섭외 우선순위</Link>에서 대상을 선정하세요.
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
                  <th>차수</th><th>성명</th><th>소속기관</th><th>이메일</th><th>상태</th><th>발송</th><th>최근 처리</th><th></th>
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
                      <td>{inv.round}차</td>
                      <td className="strong nowrap">{v?.name ?? "(삭제됨)"}</td>
                      <td>{v?.org}</td>
                      <td className="small">{v?.email || <span className="badge bad">미등록</span>}</td>
                      <td><span className={`badge ${STATE_CLS[st]}`}>{DISPLAY_STATE_LABEL[st]}</span></td>
                      <td className="small nowrap">{inv.sentAt ? `${formatDateTime(inv.sentAt)}${inv.sentVia === "email" ? " (자동)" : ""}` : "-"}</td>
                      <td className="small muted">{inv.log[0]?.action}</td>
                      <td className="nowrap">
                        <button className="btn sm primary" onClick={() => setOpen(inv.evaluatorId)} disabled={!v}>메일 보기</button>{" "}
                        {!locked && inv.status === "pending" && <button className="btn sm" onClick={() => action(inv, { type: "markSent" }, "발송 완료로 표시했습니다.")}>발송 완료</button>}{" "}
                        {!locked && inv.status === "sent" && !inv.response && <button className="btn sm ghost" onClick={() => action(inv, { type: "unmarkSent" }, "발송 표시를 취소했습니다.")}>발송 취소</button>}{" "}
                        {!locked && inv.status !== "withdrawn" && <button className="btn sm danger" onClick={() => withdraw(inv)}>철회</button>}
                        {!locked && inv.status === "withdrawn" && <button className="btn sm" onClick={() => action(inv, { type: "reinvite" }, "다시 초청 상태로 되돌렸습니다.")}>재초청</button>}{" "}
                        {!locked && inv.status === "pending" && <button className="btn sm ghost" title="목록에서 제외" onClick={() => action(inv, { type: "remove" }, "초청 대상에서 제외했습니다.")}>✕</button>}
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

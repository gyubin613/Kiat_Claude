"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import { api, ApiError, copyText, download, errMsg, useConfirm, useToast } from "@/components/ui";
import { rankEvaluators } from "@/lib/scoring";
import { inviteCounts, slotSummary } from "@/lib/summary";
import { ATTENDANCE_LABEL, weightsOf } from "@/lib/types";
import { formatDateTime, formatSlot } from "@/lib/util";
import { bachelorText, conflictHits, finalText } from "@/lib/profile";
import { ConditionReviewDialog } from "@/components/ConditionReview";

function Result({ evaluation }: { evaluation: EvalWithCounts }) {
  const { byId } = useEvalData(evaluation.id);
  const toast = useToast();
  const f = evaluation.finalization!;
  const text = [
    `[${evaluation.name}] 최종 확정`,
    `일정: ${formatSlot(f.slot)}`,
    `참석 위원(${f.members.length}명): ${f.members.map((m) => `${m.name}(${m.org})`).join(", ")}`,
  ].join("\n");
  return (
    <div className="stack">
      <div className="notice ok">
        <b>최종 확정 완료</b> · {formatDateTime(f.finalizedAt)} — 확정된 일정과 참석자는 변경할 수 없도록 보호됩니다.
      </div>
      <div className="card">
        <div className="card-head">
          <h2>확정 일정</h2>
          <div className="row">
            <button className="btn sm" onClick={async () => (await copyText(text)) && toast("확정 내용을 복사했습니다.", "ok")}>요약 복사</button>
            <button className="btn sm" onClick={() => download(`/api/admin/evaluations/${evaluation.id}/export`)}>엑셀 다운로드</button>
          </div>
        </div>
        <div className="card-body stack" style={{ gap: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatSlot(f.slot, false)}</div>
          <div className="muted">{f.slot.place}</div>
          {f.memo && <div className="small">메모: {f.memo}</div>}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>확정 참석 위원 ({f.members.length}명 / 배석 {evaluation.seats}명)</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>성명</th><th>소속기관</th><th>회신</th><th>이메일 (현재)</th><th>연락처 (현재)</th></tr></thead>
            <tbody>
              {f.members.map((m, i) => {
                const cur = byId.get(m.evaluatorId);
                return (
                  <tr key={m.evaluatorId}>
                    <td>{i + 1}</td>
                    <td className="strong">{m.name}</td>
                    <td>{m.org}</td>
                    <td><span className={`badge ${m.attendance === "yes" ? "ok" : "warn"}`}>{ATTENDANCE_LABEL[m.attendance]}</span></td>
                    <td className="small">{cur?.email || "-"}</td>
                    <td className="small">{cur?.phone || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-body small muted">
          성명·소속은 확정 시점 기준으로 보존됩니다. 연락처 등 기본정보는 <Link href={`/admin/evaluators?e=${evaluation.id}`}>평가위원 명단</Link>에서 정정할 수 있으며, 확정 결과에는 영향을 주지 않습니다.
        </div>
      </div>
    </div>
  );
}

function Finalize({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const { invites, evaluators, byId, ready, reload } = useEvalData(evaluation.id, { pollMs: 20000 });
  const slots = useMemo(() => slotSummary(evaluation, invites ?? []), [evaluation, invites]);
  const counts = useMemo(() => inviteCounts(invites ?? []), [invites]);
  const best = useMemo(() => [...slots].sort((a, b) => b.confirmable - a.confirmable || b.total - a.total)[0], [slots]);
  const [review, setReview] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const rankMap = useMemo(() => new Map(rankEvaluators(evaluators ?? [], weightsOf(evaluation)).map((r) => [r.id, r])), [evaluators, evaluation]);
  const chosen = slots.find((s) => s.slot.id === slotId);
  const candidates = useMemo(() => {
    if (!chosen) return [];
    const order = { yes: 0, accepted: 1, pending: 2 } as const;
    const list = [
      ...chosen.yes.map((id) => ({ id, kind: "yes" as const })),
      ...chosen.accepted.map((id) => ({ id, kind: "accepted" as const })),
      ...chosen.conditional.map((id) => ({ id, kind: "pending" as const })),
    ];
    return list.sort((a, b) => order[a.kind] - order[b.kind] || (rankMap.get(a.id)?.rank ?? 999) - (rankMap.get(b.id)?.rank ?? 999));
  }, [chosen, rankMap]);

  // 일정 선택 시 '참석 가능' 위원 중 우선순위 상위로 배석 인원만큼 기본 선택
  useEffect(() => {
    if (!chosen) return;
    setPicked(new Set(candidates.filter((c) => c.kind !== "pending").slice(0, evaluation.seats).map((c) => c.id)));
  }, [slotId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!chosen) return;
    const names = [...picked].map((id) => byId.get(id)?.name).join(", ");
    const warn = [
      picked.size !== evaluation.seats && `선택 인원(${picked.size}명)이 배석 인원(${evaluation.seats}명)과 다릅니다.`,
      counts.waiting + counts.notSent > 0 && `아직 회신하지 않은 위원이 ${counts.waiting + counts.notSent}명 있습니다.`,
      ...[...picked].flatMap((id) => {
        const v = byId.get(id);
        const hits = v ? conflictHits(v, evaluation.conflictKeywords) : [];
        return hits.length ? [`${v!.name} 위원: 이해관계 확인 필요 (${hits.map((h) => `${h.field} ${h.value}`).join(", ")})`] : [];
      }),
    ].filter(Boolean);
    const ok = await confirm({
      title: "최종 확정",
      confirmText: "확정",
      message: (
        <div className="stack" style={{ gap: 8 }}>
          <div><b>{formatSlot(chosen.slot)}</b></div>
          <div>참석 위원 {picked.size}명: {names}</div>
          {warn.map((w) => <div key={String(w)} className="notice warn">{w}</div>)}
          <div className="small muted">확정 후에는 일정과 참석자를 변경할 수 없으며, 평가위원 회신도 잠깁니다.</div>
        </div>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/admin/evaluations/${evaluation.id}/finalize`, {
        method: "POST",
        json: { slotId: chosen.slot.id, evaluatorIds: [...picked], memo, version: evaluation.version },
      });
      toast("최종 확정했습니다.", "ok");
      await reloadShell();
    } catch (e) {
      toast(errMsg(e), "bad");
      if (e instanceof ApiError && e.status === 409) await reloadShell();
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div className="muted">불러오는 중…</div>;
  if (!invites?.length)
    return (
      <div className="card">
        <div className="empty">회신 결과가 없습니다. <Link href={`/admin/priority?e=${evaluation.id}`}>우선순위·섭외</Link>에서 초청 대상을 먼저 선정하세요.</div>
      </div>
    );

  return (
    <div className="stack">
      {counts.waiting + counts.notSent > 0 && (
        <div className="notice warn">아직 회신하지 않은 위원이 {counts.waiting + counts.notSent}명 있습니다. 회신 기한 이후 확정하거나, 현재 결과로 확정할 수 있습니다.</div>
      )}
      <div className="card">
        <div className="card-head"><h2>1. 최종 평가 일시 선택</h2></div>
        <div className="card-body choice-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {slots.map((s) => (
            <button key={s.slot.id} className={`choice radio ${slotId === s.slot.id ? "on" : ""}`} onClick={() => setSlotId(s.slot.id)} aria-pressed={slotId === s.slot.id}>
              <span className="tick">{slotId === s.slot.id ? "●" : ""}</span>
              <span style={{ display: "grid", gap: 4 }}>
                <b>{formatSlot(s.slot, false)}</b>
                <span className="small muted">{s.slot.place}</span>
                <span className="row small" style={{ gap: 6 }}>
                  <span className="badge ok">가능 {s.confirmable}</span>
                  {s.conditional.length > 0 && <span className="badge warn">검토 필요 {s.conditional.length}</span>}
                  {best?.slot.id === s.slot.id && s.total > 0 && <span className="badge dark">최다 가능</span>}
                  {!s.meetsSeatsWithConditional && <span className="badge bad">{evaluation.seats - s.total}명 부족</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {chosen && (
        <div className="card">
          <div className="card-head">
            <h2>2. 참석 위원 선정</h2>
            <span className={`badge ${picked.size === evaluation.seats ? "ok" : "warn"}`}>선택 {picked.size} / 배석 {evaluation.seats}명</span>
          </div>
          {candidates.length === 0 ? (
            <div className="empty">이 일정에 참석 가능한 위원이 없습니다. 다른 일정을 고르거나 우선순위·섭외 화면에서 위원을 더 초청해 주세요.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th></th><th>위원</th><th>학력</th><th>회신</th><th className="num">순위</th><th>참고사항</th></tr></thead>
                <tbody>
                  {candidates.map((c) => {
                    const v = byId.get(c.id);
                    const inv = invites.find((i) => i.evaluatorId === c.id);
                    const on = picked.has(c.id);
                    const can = c.kind !== "pending";
                    const hits = v ? conflictHits(v, evaluation.conflictKeywords) : [];
                    const toggle = () => can && setPicked((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; });
                    return (
                      <tr key={c.id} className={on ? "selected" : can ? "" : "dim"} style={{ cursor: can ? "pointer" : "default" }} onClick={toggle}>
                        <td><input type="checkbox" checked={on} disabled={!can} readOnly aria-label={`${v?.name} 선택`} /></td>
                        <td>
                          <div className="who">
                            <b>{v?.name}</b>
                            <span>{v?.org}</span>
                            {hits.length > 0 && <span className="conflict" title={hits.map((h) => `${h.field}: ${h.value}`).join("\n")}>이해관계 확인 필요 ({hits.map((h) => h.field).join(", ")})</span>}
                          </div>
                        </td>
                        <td>
                          {v && (
                            <div className="edu">
                              {bachelorText(v) ? <span><span className="k">학사</span>{bachelorText(v)}</span> : <span className="faint">미입력</span>}
                              {finalText(v) && <span><span className="k">최종</span>{finalText(v)}</span>}
                            </div>
                          )}
                        </td>
                        <td>
                          {c.kind === "yes" && <span className="badge ok">참석 가능</span>}
                          {c.kind === "accepted" && <span className="badge ok">조건부 · 수락</span>}
                          {c.kind === "pending" && (
                            <button className="btn sm" onClick={(e) => { e.stopPropagation(); setReview(c.id); }}>조건 검토 필요</button>
                          )}
                        </td>
                        <td className="num">{rankMap.get(c.id)?.rank ?? "-"}</td>
                        <td className="small">{inv?.response?.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-body row">
            <input className="input" style={{ flex: 1, minWidth: 240 }} placeholder="확정 메모 (선택)" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <button className="btn primary lg" disabled={!picked.size || busy} onClick={submit}>최종 확정</button>
          </div>
        </div>
      )}
      {review && (() => {
        const inv = invites.find((i) => i.evaluatorId === review);
        const v = byId.get(review);
        return inv?.response && v ? (
          <ConditionReviewDialog
            evaluation={evaluation}
            invite={inv}
            evaluator={v}
            initial="accepted"
            onClose={() => setReview(null)}
            onDone={() => {
              reload();
              reloadShell();
            }}
          />
        ) : null;
      })()}
    </div>
  );
}

export default function FinalizePage() {
  return (
    <NeedEvaluation>
      {(e) => (
        <div className="stack">
          <div className="page-head">
            <div>
              <h1>최종 확정</h1>
              <p>일정을 고르고 참석 위원을 선택합니다. 조건부 회신은 수락한 위원만 고를 수 있습니다.</p>
            </div>
          </div>
          {e.status === "finalized" ? <Result key={e.id} evaluation={e} /> : <Finalize key={e.id} evaluation={e} />}
        </div>
      )}
    </NeedEvaluation>
  );
}

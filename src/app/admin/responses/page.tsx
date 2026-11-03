"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import { ConditionReviewDialog } from "@/components/ConditionReview";
import { api, download, errMsg, RowMenu, useToast } from "@/components/ui";
import { inviteCounts, isConditionPending, slotSummary } from "@/lib/summary";
import { conflictHits } from "@/lib/profile";
import { DISPLAY_STATE_LABEL, inviteDisplayState, STATE_CLASS, type InviteDisplayState } from "@/lib/types";
import { formatDateTime, formatSlot } from "@/lib/util";

type Filter = "all" | "pending" | "review" | "yes" | "no";

function Responses({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell } = useAdmin();
  const toast = useToast();
  const { invites, byId, ready, reload } = useEvalData(evaluation.id, { pollMs: 15000 });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [slotFilter, setSlotFilter] = useState<string | null>(null);
  const [review, setReview] = useState<{ id: string; decision: "accepted" | "rejected" } | null>(null);
  const locked = evaluation.status === "finalized";

  const counts = useMemo(() => inviteCounts(invites ?? []), [invites]);
  const slots = useMemo(() => slotSummary(evaluation, invites ?? []), [evaluation, invites]);
  const slotNo = new Map(evaluation.slots.map((s, i) => [s.id, i + 1]));
  const pendingReview = (invites ?? []).filter(isConditionPending);

  const match = (st: InviteDisplayState, f: Filter) =>
    f === "all" ||
    (f === "pending" && (st === "waiting" || st === "not_sent")) ||
    (f === "review" && st === "conditional") ||
    (f === "yes" && (st === "yes" || st === "cond_accepted")) ||
    (f === "no" && (st === "no" || st === "cond_rejected" || st === "withdrawn"));

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (invites ?? []).filter((inv) => {
      const v = byId.get(inv.evaluatorId);
      if (!match(inviteDisplayState(inv), filter)) return false;
      if (slotFilter && !(inv.status !== "withdrawn" && inv.response?.slotIds.includes(slotFilter))) return false;
      return !k || [v?.name ?? "", v?.org ?? ""].some((s) => s.toLowerCase().includes(k));
    });
  }, [invites, byId, q, filter, slotFilter]);

  const filters: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "전체", n: counts.total },
    { key: "pending", label: "미회신", n: counts.waiting + counts.notSent },
    { key: "review", label: "조건 검토", n: counts.condPending },
    { key: "yes", label: "참석 가능", n: counts.yes + counts.conditional - counts.condPending },
    { key: "no", label: "불참·철회", n: counts.no + counts.withdrawn },
  ];

  async function undoReview(evaluatorId: string) {
    try {
      await api(`/api/admin/evaluations/${evaluation.id}/invites/${evaluatorId}`, { method: "POST", json: { type: "reviewCondition", decision: null } });
      toast("검토 결과를 취소했습니다.", "ok");
      await Promise.all([reload(), reloadShell()]);
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  }

  const reviewInv = review ? invites?.find((i) => i.evaluatorId === review.id) : undefined;
  const reviewEv = review ? byId.get(review.id) : undefined;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>회신 현황</h1>
          <p>위원 회신이 15초마다 자동으로 반영됩니다.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => download(`/api/admin/evaluations/${evaluation.id}/export`)} disabled={!invites?.length}>엑셀 다운로드</button>
          <Link className="btn primary" href={`/admin/finalize?e=${evaluation.id}`}>최종 확정하기</Link>
        </div>
      </div>

      <div className="strip">
        <span className="item"><span className="n">{counts.responded}</span><span className="l">/ {counts.total - counts.withdrawn}명 회신</span></span>
        <span className="item ok"><span className="n">{counts.yes + counts.conditional - counts.condPending}</span><span className="l">참석 가능</span></span>
        {counts.condPending > 0 && <span className="item warn"><span className="n">{counts.condPending}</span><span className="l">조건 검토 필요</span></span>}
        <span className="item bad"><span className="n">{counts.no}</span><span className="l">불참</span></span>
        <span className="item"><span className="n">{counts.waiting + counts.notSent}</span><span className="l">미회신</span></span>
      </div>

      {pendingReview.length > 0 && !locked && (
        <div className="card" style={{ borderColor: "#e8c98a" }}>
          <div className="card-head">
            <h2>조건부 참석 검토 ({pendingReview.length})</h2>
            <span className="small muted">수락한 위원만 최종 확정 후보에 들어갑니다.</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {pendingReview.map((inv) => {
                  const v = byId.get(inv.evaluatorId);
                  return (
                    <tr key={inv.evaluatorId}>
                      <td style={{ width: 180 }}><div className="who"><b>{v?.name}</b><span>{v?.org}</span></div></td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{inv.response?.note || <span className="faint">조건 미기재</span>}</td>
                      <td className="nowrap small">{inv.response?.slotIds.map((id) => `${slotNo.get(id)}번`).join(", ")}</td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        <button className="btn sm primary" onClick={() => setReview({ id: inv.evaluatorId, decision: "accepted" })}>수락</button>{" "}
                        <button className="btn sm danger" onClick={() => setReview({ id: inv.evaluatorId, decision: "rejected" })}>거절</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>후보 일정별 참석 가능 인원</h2>
          <span className="small muted">배석 {evaluation.seats}명 기준 · 행을 누르면 그 일정 가능자만 봅니다</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>#</th><th>후보 일정</th><th style={{ minWidth: 170 }}>확보</th><th>판정</th><th>가능 위원</th></tr>
            </thead>
            <tbody>
              {slots.map((s, i) => (
                <tr key={s.slot.id} className={slotFilter === s.slot.id ? "selected" : ""} style={{ cursor: "pointer" }} onClick={() => setSlotFilter(slotFilter === s.slot.id ? null : s.slot.id)}>
                  <td>{i + 1}</td>
                  <td>
                    <div className="who">
                      <b>{formatSlot(s.slot, false)}{evaluation.finalization?.slotId === s.slot.id && <span className="badge ok" style={{ marginLeft: 6 }}>확정</span>}</b>
                      <span>{s.slot.place}</span>
                    </div>
                  </td>
                  <td>
                    <div className="progress">
                      <span className="small">{s.confirmable}명{s.conditional.length ? ` + 검토 ${s.conditional.length}` : ""}</span>
                      <div className="bar">
                        <span className="yes" style={{ width: `${Math.min(100, (s.confirmable / evaluation.seats) * 100)}%` }} />
                        <span className="cond" style={{ width: `${Math.max(0, Math.min(100 - (s.confirmable / evaluation.seats) * 100, (s.conditional.length / evaluation.seats) * 100))}%` }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    {s.meetsSeats ? <span className="badge ok">충족</span> : s.meetsSeatsWithConditional ? <span className="badge warn">검토 후 충족 가능</span> : <span className="badge bad">{evaluation.seats - s.total}명 부족</span>}
                  </td>
                  <td className="small">
                    {[...s.yes, ...s.accepted].map((id) => byId.get(id)?.name).join(", ")}
                    {s.conditional.length > 0 && <span style={{ color: "var(--warn)" }}> {s.conditional.map((id) => `${byId.get(id)?.name}(검토)`).join(", ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="row" style={{ flex: 1 }}>
            <input className="input" style={{ maxWidth: 240 }} placeholder="이름·소속 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="회신 검색" />
            <div className="seg" role="tablist">
              {filters.map((f) => (
                <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
                  {f.label} {f.n}
                </button>
              ))}
            </div>
            {slotFilter && <button className="btn sm ghost" onClick={() => setSlotFilter(null)}>일정 {slotNo.get(slotFilter)}번만 보기 해제</button>}
          </div>
        </div>
        {!ready ? (
          <div className="empty">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="empty">조건에 맞는 회신이 없습니다.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>위원</th><th>상태</th><th>가능 일정</th><th>참고사항</th><th>회신 일시</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const v = byId.get(inv.evaluatorId);
                  const st = inviteDisplayState(inv);
                  const hits = v ? conflictHits(v, evaluation.conflictKeywords) : [];
                  return (
                    <tr key={inv.evaluatorId} className={st === "withdrawn" ? "dim" : ""}>
                      <td>
                        <div className="who">
                          <b>{v?.name}</b>
                          <span>{v?.org} · {inv.round}차</span>
                          {hits.length > 0 && <span className="conflict">이해관계 확인 필요</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${STATE_CLASS[st]}`}>{DISPLAY_STATE_LABEL[st]}</span>
                      </td>
                      <td className="nowrap">
                        {inv.response?.slotIds.length ? (
                          <div className="tags">{inv.response.slotIds.map((id) => <span key={id} className="badge info">{slotNo.get(id)}번</span>)}</div>
                        ) : (
                          <span className="faint">-</span>
                        )}
                      </td>
                      <td className="small" style={{ maxWidth: 320 }}>
                        {inv.response?.note || (inv.withdrawnReason && `철회: ${inv.withdrawnReason}`) || <span className="faint">-</span>}
                        {inv.conditionReview?.note && <div className="muted">검토 메모: {inv.conditionReview.note}</div>}
                      </td>
                      <td className="small nowrap">
                        {formatDateTime(inv.response?.updatedAt)}
                        {inv.response && inv.response.revision > 1 && <div className="faint">(수정 {inv.response.revision - 1}회)</div>}
                      </td>
                      <td className="nowrap" style={{ textAlign: "right" }}>
                        {!locked && st === "conditional" && <button className="btn sm" onClick={() => setReview({ id: inv.evaluatorId, decision: "accepted" })}>검토</button>}
                        {!locked && (st === "cond_accepted" || st === "cond_rejected") && (
                          <RowMenu
                            items={[
                              { label: st === "cond_accepted" ? "거절로 변경" : "수락으로 변경", onClick: () => setReview({ id: inv.evaluatorId, decision: st === "cond_accepted" ? "rejected" : "accepted" }) },
                              { label: "검토 취소", onClick: () => undoReview(inv.evaluatorId) },
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

      {review && reviewInv?.response && reviewEv && (
        <ConditionReviewDialog
          evaluation={evaluation}
          invite={reviewInv}
          evaluator={reviewEv}
          initial={review.decision}
          onClose={() => setReview(null)}
          onDone={() => {
            reload();
            reloadShell();
          }}
        />
      )}
    </div>
  );
}

export default function ResponsesPage() {
  return <NeedEvaluation>{(e) => <Responses key={e.id} evaluation={e} />}</NeedEvaluation>;
}

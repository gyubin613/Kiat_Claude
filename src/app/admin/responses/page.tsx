"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { NeedEvaluation, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import { download } from "@/components/ui";
import { inviteCounts, slotSummary } from "@/lib/summary";
import { DISPLAY_STATE_LABEL, inviteDisplayState, type InviteDisplayState } from "@/lib/types";
import { formatDateTime, formatSlot } from "@/lib/util";

const STATE_CLS: Record<InviteDisplayState, string> = {
  not_sent: "", waiting: "info", yes: "ok", conditional: "warn", no: "bad", withdrawn: "bad",
};

function Responses({ evaluation }: { evaluation: EvalWithCounts }) {
  const { invites, byId, ready, reload } = useEvalData(evaluation.id, { pollMs: 15000 });
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | InviteDisplayState | "pending">("all");
  const [slotFilter, setSlotFilter] = useState<string | null>(null);

  const counts = useMemo(() => inviteCounts(invites ?? []), [invites]);
  const slots = useMemo(() => slotSummary(evaluation, invites ?? []), [evaluation, invites]);
  const slotNo = new Map(evaluation.slots.map((s, i) => [s.id, i + 1]));

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (invites ?? []).filter((inv) => {
      const v = byId.get(inv.evaluatorId);
      const st = inviteDisplayState(inv);
      if (state === "pending" ? !(st === "waiting" || st === "not_sent") : state !== "all" && st !== state) return false;
      if (slotFilter && !(inv.status !== "withdrawn" && inv.response?.slotIds.includes(slotFilter))) return false;
      return !k || [v?.name ?? "", v?.org ?? ""].some((s) => s.toLowerCase().includes(k));
    });
  }, [invites, byId, q, state, slotFilter]);

  const filters: { key: typeof state; label: string; n: number }[] = [
    { key: "all", label: "전체", n: counts.total },
    { key: "pending", label: "미회신", n: counts.waiting + counts.notSent },
    { key: "yes", label: "참석 가능", n: counts.yes },
    { key: "conditional", label: "조건부", n: counts.conditional },
    { key: "no", label: "참석 불가", n: counts.no },
    { key: "withdrawn", label: "섭외 철회", n: counts.withdrawn },
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>⑤ 회신 취합 및 일정 현황</h1>
          <p>평가위원 회신이 실시간으로 반영됩니다. (15초마다 자동 갱신)</p>
        </div>
        <div className="row">
          <button className="btn" onClick={reload}>새로고침</button>
          <button className="btn" onClick={() => download(`/api/admin/evaluations/${evaluation.id}/export`)} disabled={!invites?.length}>엑셀 다운로드</button>
          <Link className="btn primary" href={`/admin/finalize?e=${evaluation.id}`}>⑥ 최종 확정으로 →</Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="label">유효 초청</div><div className="value">{counts.total - counts.withdrawn}</div></div>
        <div className="stat"><div className="label">회신 완료</div><div className="value">{counts.responded}</div></div>
        <div className="stat warn"><div className="label">회신 대기</div><div className="value">{counts.waiting}</div></div>
        <div className="stat"><div className="label">미발송</div><div className="value">{counts.notSent}</div></div>
        <div className="stat ok"><div className="label">참석 가능</div><div className="value">{counts.yes}</div></div>
        <div className="stat warn"><div className="label">조건부 가능</div><div className="value">{counts.conditional}</div></div>
        <div className="stat bad"><div className="label">참석 불가</div><div className="value">{counts.no}</div></div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>후보 일정별 참석 가능 인원</h2>
          <span className="small muted">배석 인원 {evaluation.seats}명 기준 · 행을 누르면 해당 일정 가능자만 표시</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>#</th><th>후보 일정</th><th>장소</th><th className="num">가능</th><th className="num">조건부</th><th style={{ minWidth: 180 }}>충족도</th><th>판정</th><th>가능 위원</th></tr>
            </thead>
            <tbody>
              {slots.map((s, i) => (
                <tr key={s.slot.id} className={slotFilter === s.slot.id ? "selected" : ""} style={{ cursor: "pointer" }} onClick={() => setSlotFilter(slotFilter === s.slot.id ? null : s.slot.id)}>
                  <td>{i + 1}</td>
                  <td className="nowrap strong">{formatSlot(s.slot, false)}{evaluation.finalization?.slotId === s.slot.id && <span className="badge ok" style={{ marginLeft: 6 }}>확정</span>}</td>
                  <td className="small">{s.slot.place}</td>
                  <td className="num strong" style={{ color: "var(--ok)" }}>{s.yes.length}</td>
                  <td className="num" style={{ color: "var(--warn)" }}>{s.conditional.length}</td>
                  <td>
                    <div className="bar" title={`${s.yes.length + s.conditional.length}/${evaluation.seats}`}>
                      <span className="yes" style={{ width: `${Math.min(100, (s.yes.length / evaluation.seats) * 100)}%` }} />
                      <span className="cond" style={{ width: `${Math.min(100 - Math.min(100, (s.yes.length / evaluation.seats) * 100), (s.conditional.length / evaluation.seats) * 100)}%` }} />
                    </div>
                  </td>
                  <td>
                    {s.meetsSeats ? <span className="badge ok">충족</span> : s.meetsSeatsWithConditional ? <span className="badge warn">조건부 포함 충족</span> : <span className="badge bad">{evaluation.seats - s.total}명 부족</span>}
                  </td>
                  <td className="small">
                    {s.yes.map((id) => byId.get(id)?.name).join(", ")}
                    {s.conditional.length > 0 && <span style={{ color: "var(--warn)" }}>{s.yes.length ? ", " : ""}{s.conditional.map((id) => `${byId.get(id)?.name}(조건부)`).join(", ")}</span>}
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
            <input className="input" style={{ maxWidth: 260 }} placeholder="이름·소속기관 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="회신 검색" />
            {filters.map((f) => (
              <button key={f.key} className={`btn sm ${state === f.key ? "primary" : ""}`} onClick={() => setState(f.key)}>
                {f.label} {f.n}
              </button>
            ))}
            {slotFilter && <button className="btn sm ghost" onClick={() => setSlotFilter(null)}>일정 {slotNo.get(slotFilter)}번 필터 해제 ✕</button>}
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
                <tr><th>차수</th><th>성명</th><th>소속기관</th><th>상태</th><th>가능 일정</th><th>참고사항</th><th>회신 일시</th></tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const v = byId.get(inv.evaluatorId);
                  const st = inviteDisplayState(inv);
                  return (
                    <tr key={inv.evaluatorId} className={st === "withdrawn" ? "dim" : ""}>
                      <td>{inv.round}차</td>
                      <td className="strong nowrap">{v?.name}</td>
                      <td>{v?.org}</td>
                      <td><span className={`badge ${STATE_CLS[st]}`}>{DISPLAY_STATE_LABEL[st]}</span></td>
                      <td className="nowrap">
                        {inv.response?.slotIds.length
                          ? inv.response.slotIds.map((id) => <span key={id} className="badge info" style={{ marginRight: 4 }} title={formatSlot(evaluation.slots.find((s) => s.id === id) ?? { date: "", start: "", end: "" })}>{slotNo.get(id)}번</span>)
                          : <span className="faint">-</span>}
                      </td>
                      <td className="small">{inv.response?.note || (inv.withdrawnReason && `철회: ${inv.withdrawnReason}`) || <span className="faint">-</span>}</td>
                      <td className="small nowrap">
                        {formatDateTime(inv.response?.updatedAt)}
                        {inv.response && inv.response.revision > 1 && <span className="faint"> (수정 {inv.response.revision - 1}회)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResponsesPage() {
  return <NeedEvaluation>{(e) => <Responses key={e.id} evaluation={e} />}</NeedEvaluation>;
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import { api, errMsg, useToast } from "@/components/ui";
import { rankEvaluators } from "@/lib/scoring";
import { DISPLAY_STATE_LABEL, inviteDisplayState, type InviteDisplayState } from "@/lib/types";

const STATE_CLS: Record<InviteDisplayState, string> = {
  not_sent: "", waiting: "info", yes: "ok", conditional: "warn", no: "bad", withdrawn: "bad",
};

function Priority({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell } = useAdmin();
  const toast = useToast();
  const { invites, evaluators, reload, ready } = useEvalData(evaluation.id);
  const [weight, setWeight] = useState(evaluation.historyWeight);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = evaluation.status === "finalized";

  useEffect(() => setWeight(evaluation.historyWeight), [evaluation.id, evaluation.historyWeight]);

  const inviteMap = useMemo(() => new Map((invites ?? []).map((i) => [i.evaluatorId, i])), [invites]);
  const ranked = useMemo(() => rankEvaluators(evaluators ?? [], weight), [evaluators, weight]);
  const visible = useMemo(() => {
    const k = filter.trim().toLowerCase();
    return k ? ranked.filter((v) => [v.expertise, v.org, v.name].some((s) => s.toLowerCase().includes(k))) : ranked;
  }, [ranked, filter]);

  // 섭외 현황: 참석 불가·철회를 제외한 유효 초청 인원 기준으로 부족 인원 계산
  const active = (invites ?? []).filter((i) => i.status !== "withdrawn" && i.response?.attendance !== "no");
  const lost = (invites ?? []).filter((i) => i.status === "withdrawn" || i.response?.attendance === "no");
  const confirmedYes = (invites ?? []).filter((i) => i.status !== "withdrawn" && i.response && i.response.attendance !== "no").length;
  const shortage = Math.max(0, evaluation.seats - active.length);
  const candidates = visible.filter((v) => !inviteMap.has(v.id));
  const autoCount = !invites?.length ? evaluation.seats : Math.max(shortage, 1);

  function autoSelect(n: number) {
    setSelected(new Set(candidates.slice(0, n).map((v) => v.id)));
  }

  async function saveWeight() {
    try {
      await api(`/api/admin/evaluations/${evaluation.id}`, { method: "PATCH", json: { historyWeight: weight, version: evaluation.version } });
      await reloadShell();
      toast("가중치를 저장했습니다.", "ok");
    } catch (e) {
      toast(errMsg(e), "bad");
      await reloadShell();
    }
  }

  async function invite() {
    setBusy(true);
    try {
      const r = await api<{ created: number }>(`/api/admin/evaluations/${evaluation.id}/invites`, {
        method: "POST",
        json: { evaluatorIds: [...selected] },
      });
      toast(`${r.created}명을 초청 대상에 추가했습니다. ④ 초청 메일에서 발송하세요.`, "ok");
      setSelected(new Set());
      await Promise.all([reload(), reloadShell()]);
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>③ 섭외 우선순위 검토</h1>
          <p>과거 초청·참여 이력과 관리자 선호도로 산출한 참고 점수 순으로 초청 대상을 선정합니다.</p>
        </div>
        <Link className="btn" href={`/admin/invites?e=${evaluation.id}`}>④ 초청 메일로 →</Link>
      </div>

      <div className="notice">
        ※ 참고 점수는 섭외 순서를 검토하기 위한 자료이며, <b>실제 참석 가능성을 예측·보증하지 않습니다.</b> 최종 선정은 담당자가 판단합니다.
      </div>

      {locked && <div className="notice ok">최종 확정된 평가입니다. 초청 대상을 변경할 수 없습니다.</div>}

      <div className="grid-2">
        <div className="card">
          <div className="card-body stack" style={{ gap: 10 }}>
            <div className="row between">
              <h3>가중치 조정</h3>
              <button className="btn sm" onClick={saveWeight} disabled={locked || weight === evaluation.historyWeight}>이 평가에 저장</button>
            </div>
            <input className="slider" type="range" min={0} max={100} step={10} value={weight} disabled={locked} onChange={(e) => setWeight(Number(e.target.value))} aria-label="과거 이력 가중치" />
            <div className="row between small">
              <span>과거 이력 <b>{weight}%</b></span>
              <span>관리자 선호도 <b>{100 - weight}%</b></span>
            </div>
            <p className="small muted">
              이력 점수 = (참여+1)/(초청+2), 이력이 없으면 중립 50점 · 선호도 미입력 시 중립(3점) 적용
            </p>
          </div>
        </div>
        <div className="card">
          <div className="card-body stack" style={{ gap: 10 }}>
            <h3>섭외 현황 (배석 {evaluation.seats}명)</h3>
            <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div className="stat"><div className="label">유효 초청</div><div className="value">{active.length}</div></div>
              <div className="stat ok"><div className="label">참석 회신</div><div className="value">{confirmedYes}</div></div>
              <div className={`stat ${shortage ? "bad" : "ok"}`}><div className="label">추가 필요</div><div className="value">{shortage}</div></div>
            </div>
            {lost.length > 0 && shortage > 0 && !locked && (
              <div className="notice warn row between">
                <span>참석 불가·섭외 철회 {lost.length}명 발생 — 후순위 후보 {shortage}명을 추가 검토하세요.</span>
                <button className="btn sm" onClick={() => autoSelect(shortage)}>후순위 {shortage}명 선택</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="row" style={{ flex: 1 }}>
            <input className="input" style={{ maxWidth: 280 }} placeholder="전문분야·소속으로 후보 좁히기" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="후보 필터" />
            {!locked && (
              <button className="btn sm" onClick={() => autoSelect(autoCount)} disabled={!candidates.length}>
                {!invites?.length ? `상위 ${autoCount}명 자동 선택` : shortage ? `부족 인원 ${autoCount}명 자동 선택` : "다음 순위 1명 선택"}
              </button>
            )}
            {selected.size > 0 && <button className="btn sm ghost" onClick={() => setSelected(new Set())}>선택 해제</button>}
          </div>
          {!locked && (
            <button className="btn primary" disabled={!selected.size || busy} onClick={invite}>
              선택한 {selected.size}명 초청 대상에 추가
            </button>
          )}
        </div>
        {!ready ? (
          <div className="empty">불러오는 중…</div>
        ) : !evaluators?.length ? (
          <div className="empty">
            평가위원 명단이 비어 있습니다. <Link href={`/admin/evaluators?e=${evaluation.id}`}>② 평가위원 명단</Link>에서 먼저 등록하세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th><th className="num">순위</th><th>성명</th><th>소속기관</th><th>전문분야</th>
                  <th className="num">초청/참여</th><th className="num">선호도</th><th style={{ minWidth: 160 }}>참고 점수</th><th>이 평가 상태</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => {
                  const inv = inviteMap.get(v.id);
                  const st = inv ? inviteDisplayState(inv) : null;
                  return (
                    <tr key={v.id} className={selected.has(v.id) ? "selected" : inv ? "dim" : ""} onClick={() => !inv && !locked && toggle(v.id)} style={{ cursor: inv || locked ? "default" : "pointer" }}>
                      <td>
                        <input type="checkbox" checked={selected.has(v.id)} disabled={!!inv || locked} onChange={() => toggle(v.id)} onClick={(e) => e.stopPropagation()} aria-label={`${v.name} 선택`} />
                      </td>
                      <td className="num">{v.rank}</td>
                      <td className="strong nowrap">{v.name}</td>
                      <td>{v.org}</td>
                      <td className="small">{v.expertise}</td>
                      <td className="num">
                        {v.score.historyIsNeutral ? <span className="faint">이력 없음</span> : `${v.pastInvited}/${v.pastAttended}`}
                      </td>
                      <td className="num">{v.preference ?? <span className="faint">중립</span>}</td>
                      <td>
                        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                          <div className="bar" style={{ flex: 1 }} title={`이력 ${Math.round(v.score.history * 100)} · 선호 ${Math.round(v.score.preference * 100)}`}>
                            <span className="yes" style={{ width: `${v.score.total}%` }} />
                          </div>
                          <b className="mono" style={{ width: 36, textAlign: "right" }}>{v.score.total.toFixed(1)}</b>
                        </div>
                      </td>
                      <td>{inv && st ? <span className={`badge ${STATE_CLS[st]}`}>{inv.round}차 · {DISPLAY_STATE_LABEL[st]}</span> : <span className="faint small">미초청</span>}</td>
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

export default function PriorityPage() {
  return <NeedEvaluation>{(e) => <Priority key={e.id} evaluation={e} />}</NeedEvaluation>;
}

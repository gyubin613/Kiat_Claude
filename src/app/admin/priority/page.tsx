"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { useEvalData } from "@/components/useEvalData";
import AutoQueue from "@/components/AutoQueue";
import { api, errMsg, useToast } from "@/components/ui";
import { normalizeWeights, OVERSEAS_FULL_YEARS, rankEvaluators } from "@/lib/scoring";
import { bachelorText, conflictHits, finalText, overseasTags } from "@/lib/profile";
import { isDeclined } from "@/lib/summary";
import { DISPLAY_STATE_LABEL, inviteDisplayState, STATE_CLASS, weightsOf, type Weights } from "@/lib/types";

const WEIGHT_ITEMS: { key: keyof Weights; label: string; desc: string }[] = [
  { key: "history", label: "과거 이력", desc: "초청 대비 참여 비율" },
  { key: "preference", label: "관리자 선호도", desc: "1~5점" },
  { key: "overseas", label: "해외경험", desc: `해외 대학 50% + 해외 근무 50% (${OVERSEAS_FULL_YEARS}년 이상 만점)` },
];

function Priority({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell } = useAdmin();
  const toast = useToast();
  const { invites, evaluators, reload, ready } = useEvalData(evaluation.id);
  const saved = weightsOf(evaluation);
  const [weights, setWeights] = useState<Weights>(saved);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = evaluation.status === "finalized";
  const dirty = JSON.stringify(weights) !== JSON.stringify(saved);

  useEffect(() => {
    setWeights(weightsOf(evaluation));
  }, [evaluation]);

  const ratio = normalizeWeights(weights);
  const inviteMap = useMemo(() => new Map((invites ?? []).map((i) => [i.evaluatorId, i])), [invites]);
  const ranked = useMemo(() => rankEvaluators(evaluators ?? [], weights), [evaluators, weights]);
  const visible = useMemo(() => {
    const k = filter.trim().toLowerCase();
    return ranked.filter(
      (v) =>
        (!onlyFree || !inviteMap.has(v.id)) &&
        (!k || [v.expertise, v.org, v.name, v.bachelorSchool, v.finalSchool].some((s) => s.toLowerCase().includes(k))),
    );
  }, [ranked, filter, onlyFree, inviteMap]);

  const active = (invites ?? []).filter((i) => i.status !== "withdrawn" && !isDeclined(i));
  const lost = (invites ?? []).filter((i) => i.status === "withdrawn" || isDeclined(i));
  const shortage = Math.max(0, evaluation.seats - active.length);
  const candidates = visible.filter((v) => !inviteMap.has(v.id));
  const autoCount = !invites?.length ? evaluation.seats : shortage;

  async function saveWeights() {
    try {
      await api(`/api/admin/evaluations/${evaluation.id}`, {
        method: "PATCH",
        json: { weights, historyWeight: weights.history, version: evaluation.version },
      });
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
      toast(`${r.created}명을 초청 대상에 추가했습니다. 초청 메일 화면에서 메일을 보내 주세요.`, "ok");
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
          <h1>우선순위·섭외</h1>
          <p>
            {evaluation.recruitMode === "auto"
              ? "자동 섭외: 순서를 정하고 시작하면 앞 순서부터 메일이 나갑니다. 점수는 참고자료이며 참석 가능성을 보장하지 않습니다."
              : "참고 점수 순으로 초청할 위원을 고릅니다. 점수는 참고자료이며 참석 가능성을 보장하지 않습니다."}
          </p>
        </div>
        <Link className="btn" href={`/admin/invites?e=${evaluation.id}`}>초청 메일 화면으로</Link>
      </div>

      <div className="strip">
        <span className="item"><span className="n">{active.length}</span><span className="l">/ 배석 {evaluation.seats}명 초청 중</span></span>
        {lost.length > 0 && <span className="item bad"><span className="n">{lost.length}</span><span className="l">불참·철회</span></span>}
        <span className={`item ${shortage ? "warn" : "ok"}`}><span className="n">{shortage}</span><span className="l">명 더 필요</span></span>
        <span className="spacer" />
        {!locked && autoCount > 0 && evaluation.recruitMode !== "auto" && (
          <button className="btn sm" onClick={() => setSelected(new Set(candidates.slice(0, autoCount).map((v) => v.id)))} disabled={!candidates.length}>
            {invites?.length ? `다음 순위 ${autoCount}명 선택` : `상위 ${autoCount}명 선택`}
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="row between">
            <h3>가중치</h3>
            <button className="btn sm" onClick={saveWeights} disabled={locked || !dirty}>이 평가에 저장</button>
          </div>
          <div className="weights">
            {WEIGHT_ITEMS.map((w) => (
              <div key={w.key} className="w">
                <div className="row">
                  <span className="strong">{w.label}</span>
                  <b>{Math.round(ratio[w.key] * 100)}%</b>
                </div>
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={weights[w.key]}
                  disabled={locked}
                  onChange={(e) => setWeights((s) => ({ ...s, [w.key]: Number(e.target.value) }))}
                  aria-label={`${w.label} 가중치`}
                />
                <span className="small faint">{w.desc}</span>
              </div>
            ))}
          </div>
          <p className="small faint">입력하지 않은 항목은 중립(50점)으로 계산합니다. 학력은 이해관계 확인용이며, 해외 대학 여부만 해외경험 점수에 들어갑니다.</p>
        </div>
      </div>

      {locked && <div className="notice ok">최종 확정된 평가입니다. 초청 대상을 바꿀 수 없습니다.</div>}

      {evaluation.recruitMode === "auto" ? (
        !ready ? (
          <div className="card"><div className="empty">불러오는 중…</div></div>
        ) : !evaluators?.length ? (
          <div className="card"><div className="empty">평가위원 명단이 비어 있습니다. <Link href={`/admin/evaluators?e=${evaluation.id}`}>평가위원 명단</Link>에서 먼저 등록해 주세요.</div></div>
        ) : (
          <AutoQueue
            evaluation={evaluation}
            evaluators={evaluators}
            invites={invites ?? []}
            onChanged={async () => {
              await Promise.all([reload(), reloadShell()]);
            }}
          />
        )
      ) : (
      <div className="card">
        <div className="card-head">
          <div className="row" style={{ flex: 1 }}>
            <input className="input" style={{ maxWidth: 280 }} placeholder="전문분야·소속·학교 검색" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="후보 검색" />
            <label className="row small"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> 미초청 위원만</label>
            {selected.size > 0 && <button className="btn sm ghost" onClick={() => setSelected(new Set())}>선택 해제</button>}
          </div>
          {!locked && (
            <button className="btn primary" disabled={!selected.size || busy} onClick={invite}>
              {selected.size ? `${selected.size}명 초청 대상에 추가` : "위원을 선택하세요"}
            </button>
          )}
        </div>
        {!ready ? (
          <div className="empty">불러오는 중…</div>
        ) : !evaluators?.length ? (
          <div className="empty">
            평가위원 명단이 비어 있습니다. <Link href={`/admin/evaluators?e=${evaluation.id}`}>평가위원 명단</Link>에서 먼저 등록해 주세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th><th className="num">순위</th><th>위원</th><th>학력</th><th>해외경험</th><th className="num">초청/참여</th><th className="num">선호</th>
                  <th style={{ minWidth: 130 }}>참고 점수</th><th>이 평가</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => {
                  const inv = inviteMap.get(v.id);
                  const st = inv ? inviteDisplayState(inv) : null;
                  const hits = conflictHits(v, evaluation.conflictKeywords);
                  const clickable = !inv && !locked;
                  return (
                    <tr key={v.id} className={selected.has(v.id) ? "selected" : inv ? "dim" : ""} onClick={() => clickable && toggle(v.id)} style={{ cursor: clickable ? "pointer" : "default" }}>
                      <td>
                        <input type="checkbox" checked={selected.has(v.id)} disabled={!clickable} onChange={() => toggle(v.id)} onClick={(e) => e.stopPropagation()} aria-label={`${v.name} 선택`} />
                      </td>
                      <td className="num">{v.rank}</td>
                      <td>
                        <div className="who">
                          <b>{v.name}</b>
                          <span>{v.org}</span>
                          {hits.length > 0 && (
                            <span className="conflict" title={hits.map((h) => `${h.field}: ${h.value} ↔ ${h.keyword}`).join("\n")}>이해관계 확인 필요 ({hits.map((h) => h.field).join(", ")})</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="edu">
                          {bachelorText(v) ? <span><span className="k">학사</span>{bachelorText(v)}</span> : <span className="faint">학력 미입력</span>}
                          {finalText(v) && <span><span className="k">최종</span>{finalText(v)}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="tags">
                          {overseasTags(v).map((t) => <span key={t} className="badge info">{t}</span>)}
                          {!overseasTags(v).length && <span className="faint small">{v.score.overseasIsNeutral ? "미입력" : "없음"}</span>}
                        </div>
                      </td>
                      <td className="num">{v.score.historyIsNeutral ? <span className="faint">없음</span> : `${v.pastInvited}/${v.pastAttended}`}</td>
                      <td className="num">{v.preference ?? <span className="faint">-</span>}</td>
                      <td>
                        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }} title={`이력 ${Math.round(v.score.history * 100)} · 선호 ${Math.round(v.score.preference * 100)} · 해외 ${Math.round(v.score.overseas * 100)}`}>
                          <div className="bar" style={{ flex: 1 }}><span className="yes" style={{ width: `${v.score.total}%` }} /></div>
                          <b style={{ width: 34, textAlign: "right" }}>{v.score.total.toFixed(0)}</b>
                        </div>
                      </td>
                      <td>{inv && st ? <span className={`badge ${STATE_CLASS[st]}`}>{inv.round}차 · {DISPLAY_STATE_LABEL[st]}</span> : <span className="faint small">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export default function PriorityPage() {
  return <NeedEvaluation>{(e) => <Priority key={e.id} evaluation={e} />}</NeedEvaluation>;
}

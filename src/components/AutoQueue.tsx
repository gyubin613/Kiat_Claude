"use client";

import { useEffect, useMemo, useState } from "react";
import type { EvalWithCounts } from "./AdminShell";
import { useAdmin } from "./AdminShell";
import { api, errMsg, useConfirm, useToast } from "./ui";
import { autoOrder } from "@/lib/scoring";
import { bachelorText, conflictHits, finalText, overseasTags } from "@/lib/profile";
import { isDeclined } from "@/lib/summary";
import { DISPLAY_STATE_LABEL, followupOf, inviteDisplayState, STATE_CLASS, weightsOf, type Evaluator, type Invite } from "@/lib/types";
import { formatDateTime, recipientAllowed } from "@/lib/util";

/**
 * 자동 섭외 순서: 끌어서(또는 ↑↓) 순서를 정하고 [자동 섭외 시작]을 누르면
 * 배석 인원만큼 앞 순서부터 바로 메일이 나가고, 불참·무응답이 생기면 다음 순서로 넘어간다.
 */
export default function AutoQueue({
  evaluation,
  evaluators,
  invites,
  onChanged,
}: {
  evaluation: EvalWithCounts;
  evaluators: Evaluator[];
  invites: Invite[];
  onChanged: () => Promise<void> | void;
}) {
  const { meta } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const weights = weightsOf(evaluation);
  const invMap = useMemo(() => new Map(invites.map((i) => [i.evaluatorId, i])), [invites]);
  const initialOrder = () => autoOrder(evaluators, { autoQueue: evaluation.autoQueue }, weights).map((v) => v.id);
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [excluded, setExcluded] = useState<Set<string>>(new Set(evaluation.autoExcluded ?? []));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = !!evaluation.autoRunning;
  const locked = evaluation.status === "finalized";
  const f = followupOf(evaluation);

  // 명단·저장된 순서가 바뀌면 다시 맞춤 (새로 추가된 위원은 점수순으로 뒤에 붙음)
  const rosterKey = evaluators.map((v) => v.id).sort().join(",");
  const savedKey = (evaluation.autoQueue ?? []).join(",") + "|" + (evaluation.autoExcluded ?? []).join(",");
  useEffect(() => {
    setOrder(initialOrder());
    setExcluded(new Set(evaluation.autoExcluded ?? []));
  }, [rosterKey, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(evaluators.map((v) => [v.id, v])), [evaluators]);
  const scoreOf = useMemo(() => new Map(autoOrder(evaluators, {}, weights).map((v) => [v.id, v.score.total])), [evaluators, weights]);
  const dirty = order.join(",") !== initialOrder().join(",") || [...excluded].sort().join(",") !== [...(evaluation.autoExcluded ?? [])].sort().join(",");

  // 앞으로 보낼 순서 (아직 초청하지 않았고 제외하지 않은 위원)
  const holding = invites.filter((i) => i.status !== "withdrawn" && !isDeclined(i)).length;
  const need = Math.max(0, evaluation.seats - holding);
  const upcoming = order.filter((id) => !invMap.has(id) && !excluded.has(id));
  const nextIds = new Set(upcoming.slice(0, need));
  const noEmail = upcoming.slice(0, evaluation.seats).filter((id) => !byId.get(id)?.email);
  const blocked = upcoming.slice(0, evaluation.seats).filter((id) => {
    const em = byId.get(id)?.email;
    return em && meta?.email.configured && !recipientAllowed(em, meta.email.allowList);
  });

  function move(id: string, to: number) {
    setOrder((o) => {
      const from = o.indexOf(id);
      if (from < 0) return o;
      const n = [...o];
      n.splice(from, 1);
      n.splice(Math.max(0, Math.min(to, n.length)), 0, id);
      return n;
    });
  }

  async function save(quiet = false) {
    try {
      await api(`/api/admin/evaluations/${evaluation.id}`, {
        method: "PATCH",
        json: { autoQueue: order, autoExcluded: [...excluded], version: evaluation.version },
      });
      if (!quiet) toast("자동 섭외 순서를 저장했습니다.", "ok");
      await onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
      await onChanged();
    }
  }

  async function start() {
    const n = Math.min(need, upcoming.length);
    const ok = await confirm({
      title: "자동 섭외 시작",
      confirmText: "시작",
      message: (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            지금 순서 앞쪽 <b>{n}명</b>에게 초청 메일을 바로 보냅니다.
            {n > 0 && <> ({upcoming.slice(0, n).map((id) => byId.get(id)?.name).join(", ")})</>}
          </div>
          <div>
            이후 <b>불참 회신</b>이 오면 즉시, <b>{f.hours}시간</b> 동안 회신이 없으면 다음 순서 위원에게 자동으로 보냅니다.
          </div>
          {!meta?.email.configured && <div className="notice warn">메일 설정이 없어 초청 대상에만 추가되고 메일은 나가지 않습니다. 먼저 메일 설정을 해 주세요.</div>}
        </div>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ result: { invited: { name: string; sent: boolean; detail?: string }[]; note?: string } | null }>(
        `/api/admin/evaluations/${evaluation.id}/auto`,
        { method: "POST", json: { action: "start", queue: order, excluded: [...excluded] } },
      );
      const inv = r.result?.invited ?? [];
      const ok2 = inv.filter((i) => i.sent).length;
      toast(
        inv.length ? `자동 섭외를 시작했습니다. ${ok2}명에게 메일을 보냈습니다.${inv.length - ok2 ? ` (보내지 못한 ${inv.length - ok2}명은 초청 메일 화면에서 확인)` : ""}` : "자동 섭외를 시작했습니다. 지금은 보낼 위원이 없습니다.",
        inv.length && ok2 < inv.length ? "bad" : "ok",
      );
      await onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!(await confirm({ title: "자동 섭외 중지", message: "더 이상 자동으로 메일을 보내지 않습니다. 이미 보낸 초청과 회신은 그대로 유지됩니다.", confirmText: "중지" }))) return;
    setBusy(true);
    try {
      await api(`/api/admin/evaluations/${evaluation.id}/auto`, { method: "POST", json: { action: "stop" } });
      toast("자동 섭외를 중지했습니다.", "ok");
      await onChanged();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  const sentCount = invites.filter((i) => i.status !== "pending").length;

  return (
    <div className="card">
      <div className="card-head">
        <div className="auto-status">
          {running && <span className="pulse" aria-hidden />}
          <h2>자동 섭외 순서</h2>
          <span className={`badge ${running ? "ok" : ""}`}>{running ? "진행 중" : locked ? "종료" : "시작 전"}</span>
          {running && evaluation.autoStartedAt && <span className="small muted">{formatDateTime(evaluation.autoStartedAt)} 시작 · 발송 {sentCount}명</span>}
        </div>
        {!locked && (
          <div className="row">
            <button className="btn sm ghost" disabled={busy} onClick={() => setOrder(autoOrder(evaluators, {}, weights).map((v) => v.id))}>점수순으로 다시 정렬</button>
            {running && dirty && <button className="btn sm" disabled={busy} onClick={() => save()}>순서 저장</button>}
            {running ? (
              <button className="btn danger" disabled={busy} onClick={stop}>자동 섭외 중지</button>
            ) : (
              <button className="btn primary" disabled={busy || !upcoming.length} onClick={start}>{busy ? "시작하는 중…" : "자동 섭외 시작"}</button>
            )}
          </div>
        )}
      </div>
      <div className="card-body small muted" style={{ paddingBottom: 10 }}>
        위원을 끌어서(또는 ↑↓) 순서를 정하세요. {running ? "순서를 바꾸면 [순서 저장]을 눌러야 다음 발송부터 반영됩니다." : `시작하면 앞 순서 ${evaluation.seats}명에게 바로 메일이 나갑니다.`} 불참 회신이 오면 즉시, {f.hours}시간 무응답이면 다음 순서로 넘어갑니다.
      </div>
      {(noEmail.length > 0 || blocked.length > 0) && (
        <div className="notice warn small" style={{ margin: "0 20px 12px" }}>
          {noEmail.length > 0 && <div>이메일이 없는 위원은 건너뜁니다: {noEmail.map((id) => byId.get(id)?.name).join(", ")}</div>}
          {blocked.length > 0 && <div>발송 허용 주소가 아니어서 메일이 나가지 않습니다: {blocked.map((id) => byId.get(id)?.name).join(", ")} (메일 설정 확인)</div>}
        </div>
      )}
      <div className="q-head">
        <span style={{ textAlign: "right" }}>순서</span><span></span><span>위원</span><span className="hide-sm">학력</span><span className="hide-sm">해외경험</span><span className="hide-sm" style={{ textAlign: "right" }}>점수</span><span>상태</span><span></span>
      </div>
      <div className="queue" onDragOver={(e) => e.preventDefault()}>
        {order.map((id, idx) => {
          const v = byId.get(id);
          if (!v) return null;
          const inv = invMap.get(id);
          const st = inv ? inviteDisplayState(inv) : null;
          const isEx = excluded.has(id);
          const hits = conflictHits(v, evaluation.conflictKeywords);
          const draggable = !locked && !inv;
          return (
            <div key={id}>
              <div
                className={`q-row ${nextIds.has(id) ? "next" : ""} ${inv ? "done" : ""} ${isEx ? "excluded" : ""} ${dragId === id ? "dragging" : ""} ${overId === id && dragId !== id ? "drag-over" : ""}`}
                draggable={draggable}
                onDragStart={(e) => {
                  setDragId(id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId) setOverId(id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = dragId ?? e.dataTransfer.getData("text/plain");
                  if (src && src !== id) move(src, order.indexOf(id));
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                data-testid={`queue-${v.name}`}
              >
                <span className="q-no">{idx + 1}</span>
                <span className="q-handle" aria-hidden title={draggable ? "끌어서 순서 변경" : ""}>{draggable ? "⠿" : ""}</span>
                <div className="who">
                  <b>{v.name}</b>
                  <span>{v.org}{!v.email && " · 이메일 없음"}</span>
                  {hits.length > 0 && <span className="conflict">이해관계 확인 필요</span>}
                </div>
                <div className="edu hide-sm">
                  {bachelorText(v) ? <span><span className="k">학사</span>{bachelorText(v)}</span> : <span className="faint">미입력</span>}
                  {finalText(v) && <span><span className="k">최종</span>{finalText(v)}</span>}
                </div>
                <div className="tags hide-sm">{overseasTags(v).map((t) => <span key={t} className="badge info">{t}</span>)}</div>
                <b className="hide-sm" style={{ textAlign: "right" }}>{(scoreOf.get(id) ?? 0).toFixed(0)}</b>
                <span>
                  {inv && st ? (
                    <span className={`badge ${STATE_CLASS[st]}`}>{DISPLAY_STATE_LABEL[st]}</span>
                  ) : isEx ? (
                    <span className="badge">제외</span>
                  ) : nextIds.has(id) ? (
                    <span className="badge info">{running ? "다음 발송" : "첫 발송 대상"}</span>
                  ) : (
                    <span className="faint small">대기</span>
                  )}
                </span>
                <span className="row" style={{ justifyContent: "flex-end", gap: 2, flexWrap: "nowrap" }}>
                  {draggable && (
                    <>
                      <button className="btn sm ghost" aria-label={`${v.name} 위로`} disabled={idx === 0} onClick={() => move(id, idx - 1)}>↑</button>
                      <button className="btn sm ghost" aria-label={`${v.name} 아래로`} disabled={idx === order.length - 1} onClick={() => move(id, idx + 1)}>↓</button>
                      <button
                        className="btn sm ghost"
                        onClick={() => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                      >
                        {isEx ? "포함" : "제외"}
                      </button>
                    </>
                  )}
                </span>
              </div>
              {!running && !locked && idx === order.findIndex((x) => x === [...nextIds].at(-1)) && nextIds.size > 0 && (
                <div className="q-cut">↑ 여기까지 시작하자마자 메일 발송 · 아래는 불참·무응답 시 순서대로 발송</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

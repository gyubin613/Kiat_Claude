"use client";

import { useEffect, useState } from "react";
import type { Attendance, InviteResponse, Slot } from "@/lib/types";
import { ATTENDANCE_LABEL } from "@/lib/types";
import { daysUntil, formatDateKo, formatDateTime, formatSlot } from "@/lib/util";

type View = {
  evaluation: { name: string; department: string; contactName: string; deadline: string; requirements: string; slots: Slot[]; finalized: boolean };
  evaluator: { name: string; org: string };
  invite: { status: "pending" | "sent" | "withdrawn"; response: InviteResponse | null };
  result: { slot: Slot; selected: boolean } | null;
};

const OPTIONS: { value: Attendance; label: string; desc: string; cls: string }[] = [
  { value: "yes", label: "참석 가능", desc: "아래 후보 일정 중 가능한 일정을 선택합니다", cls: "" },
  { value: "conditional", label: "조건부 참석 가능", desc: "시간 조정 등 조건이 있으면 참고사항에 적어 주세요", cls: "cond" },
  { value: "no", label: "참석 불가", desc: "일정 선택 없이 바로 제출할 수 있습니다", cls: "no" },
];

export default function RespondForm({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  function apply(v: View) {
    setView(v);
    const r = v.invite.response;
    setAttendance(r?.attendance ?? null);
    setSlotIds(r?.slotIds ?? []);
    setNote(r?.note ?? "");
    setEditing(!r && !v.evaluation.finalized && v.invite.status !== "withdrawn");
  }

  useEffect(() => {
    fetch(`/api/respond/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "페이지를 불러오지 못했습니다.");
        apply(d as View);
      })
      .catch((e) => setLoadErr(e.message));
  }, [token]);

  async function submit() {
    setErr("");
    if (!attendance) return setErr("참석 여부를 선택해 주세요.");
    if (attendance !== "no" && slotIds.length === 0) return setErr("참석 가능한 일정을 1개 이상 선택해 주세요.");
    if (attendance === "conditional" && !note.trim()) return setErr("조건부 참석의 조건을 참고사항에 적어 주세요.");
    setBusy(true);
    try {
      const res = await fetch(`/api/respond/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance, slotIds: attendance === "no" ? [] : slotIds, note: note.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "제출하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      apply(d as View);
      setEditing(false);
      setJustSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "제출하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loadErr)
    return (
      <div className="public">
        <div className="public-wrap">
          <div className="card"><div className="card-body stack">
            <h1>회신 페이지를 열 수 없습니다</h1>
            <p className="muted">{loadErr}</p>
            <p className="small muted">메일로 받으신 링크 전체가 주소창에 입력되었는지 확인해 주시고, 문제가 계속되면 담당자에게 문의해 주십시오.</p>
          </div></div>
        </div>
      </div>
    );
  if (!view) return <div className="public"><div className="public-wrap muted">불러오는 중…</div></div>;

  const e = view.evaluation;
  const r = view.invite.response;
  const dday = daysUntil(e.deadline);
  const slotText = (id: string) => {
    const s = e.slots.find((x) => x.id === id);
    return s ? formatSlot(s) : "(변경된 일정)";
  };

  return (
    <div className="public">
      <div className="public-wrap">
        <div className="card">
          <div className="card-body stack" style={{ gap: 8 }}>
            <span className="small muted">{e.department} 평가위원 참석 여부 회신</span>
            <h1 style={{ fontSize: 20 }}>{e.name}</h1>
            <p><b>{view.evaluator.name}</b> 위원님{view.evaluator.org && <span className="muted"> ({view.evaluator.org})</span>}, 참석 여부와 가능한 일정을 알려 주십시오.</p>
            {!e.finalized && view.invite.status !== "withdrawn" && (
              <p className="small">
                회신 기한: <b>{formatDateKo(e.deadline)}</b>
                {dday != null && (dday >= 0 ? <span className="muted"> ({dday === 0 ? "오늘까지" : `${dday}일 남음`})</span> : <span style={{ color: "var(--bad)" }}> (기한이 지났지만 아직 회신하실 수 있습니다)</span>)}
              </p>
            )}
          </div>
        </div>

        {view.invite.status === "withdrawn" && (
          <div className="notice bad">해당 평가의 초청이 철회되었습니다. 문의사항은 담당자({e.contactName || e.department})에게 연락해 주십시오.</div>
        )}

        {e.finalized && view.result && (
          <div className={`notice ${view.result.selected ? "ok" : ""}`} style={{ fontSize: 15 }}>
            {view.result.selected ? (
              <>
                <b>평가 일정이 확정되었습니다.</b>
                <br />위원님께서는 <b>{formatSlot(view.result.slot)}</b> 평가의 참석 위원으로 확정되셨습니다. 세부 안내는 담당자가 별도로 드릴 예정입니다.
              </>
            ) : (
              <>
                <b>평가 일정이 확정되었습니다.</b>
                <br />이번 평가는 다른 위원님들로 구성되었습니다. 바쁘신 중에 회신해 주셔서 감사합니다.
              </>
            )}
          </div>
        )}

        {justSaved && <div className="notice ok" role="status"><b>회신이 정상적으로 저장되었습니다.</b> 감사합니다. 일정 확정 전까지는 언제든 이 링크에서 수정하실 수 있습니다.</div>}

        {!editing && r && (
          <div className="card">
            <div className="card-head">
              <h2>제출하신 회신</h2>
              {!e.finalized && view.invite.status !== "withdrawn" && (
                <button className="btn" onClick={() => { setEditing(true); setJustSaved(false); }}>응답 수정</button>
              )}
            </div>
            <div className="card-body stack" style={{ gap: 10 }}>
              <div><span className="muted">참석 여부</span> <b>{ATTENDANCE_LABEL[r.attendance]}</b></div>
              {r.slotIds.length > 0 && (
                <div>
                  <div className="muted">참석 가능 일정</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{r.slotIds.map((id) => <li key={id}>{slotText(id)}</li>)}</ul>
                </div>
              )}
              {r.note && <div><span className="muted">참고사항</span> {r.note}</div>}
              <div className="small faint">최종 저장: {formatDateTime(r.updatedAt)}</div>
            </div>
          </div>
        )}

        {editing && (
          <>
            {e.requirements && (
              <div className="card"><div className="card-body">
                <div className="muted small" style={{ marginBottom: 4 }}>참여 요청사항</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{e.requirements}</div>
              </div></div>
            )}

            <div className="card"><div className="card-body">
              <div className="step-title"><span className="n">1</span><h2>참석 여부를 선택해 주세요</h2></div>
              <div className="choice-grid" role="radiogroup" aria-label="참석 여부">
                {OPTIONS.map((o) => (
                  <button key={o.value} type="button" role="radio" aria-checked={attendance === o.value} className={`choice radio ${o.cls} ${attendance === o.value ? "on" : ""}`} onClick={() => { setAttendance(o.value); setErr(""); }}>
                    <span className="tick">{attendance === o.value ? "✓" : ""}</span>
                    <span><b style={{ fontSize: 15 }}>{o.label}</b><br /><span className="small muted">{o.desc}</span></span>
                  </button>
                ))}
              </div>
            </div></div>

            {attendance && attendance !== "no" && (
              <div className="card"><div className="card-body">
                <div className="step-title"><span className="n">2</span><h2>참석 가능한 일정을 모두 선택해 주세요</h2></div>
                <div className="choice-grid">
                  {e.slots.map((s) => {
                    const on = slotIds.includes(s.id);
                    return (
                      <button key={s.id} type="button" role="checkbox" aria-checked={on} className={`choice ${on ? "on" : ""}`} onClick={() => { setErr(""); setSlotIds((x) => (on ? x.filter((i) => i !== s.id) : [...x, s.id])); }}>
                        <span className="tick">{on ? "✓" : ""}</span>
                        <span><b>{formatDateKo(s.date)}</b> {s.start}{s.end && `~${s.end}`}<br /><span className="small muted">{s.place}</span></span>
                      </button>
                    );
                  })}
                </div>
                {e.slots.length > 1 && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <button type="button" className="btn sm" onClick={() => setSlotIds(e.slots.map((s) => s.id))}>모두 가능</button>
                    <button type="button" className="btn sm ghost" onClick={() => setSlotIds([])}>선택 해제</button>
                  </div>
                )}
              </div></div>
            )}

            {attendance && (
              <div className="card"><div className="card-body">
                <div className="step-title"><span className="n">{attendance === "no" ? 2 : 3}</span><h2>{attendance === "no" ? "불참 사유 (선택)" : attendance === "conditional" ? "참석 조건 (필수)" : "참고사항 (선택)"}</h2></div>
                <textarea
                  className="textarea"
                  value={note}
                  maxLength={1000}
                  onChange={(ev) => { setNote(ev.target.value); setErr(""); }}
                  placeholder={attendance === "no" ? "예) 해외 출장 일정과 겹칩니다." : attendance === "conditional" ? "예) 오후 2시 이후 참석 가능합니다." : "일정 조정 요청 등 전달하실 내용이 있으면 적어 주세요."}
                  aria-label="참고사항"
                />
              </div></div>
            )}

            {err && <div className="notice bad" role="alert">{err}</div>}
            <div className="row">
              {r && <button className="btn lg" onClick={() => apply(view)}>수정 취소</button>}
              <button className="btn primary lg" style={{ flex: 1 }} disabled={busy || !attendance} onClick={submit}>
                {busy ? "제출 중…" : r ? "수정한 내용 제출" : "회신 제출"}
              </button>
            </div>
          </>
        )}

        <p className="small faint" style={{ textAlign: "center" }}>
          본 페이지는 위원님께 개별 발송된 링크입니다. 타인과 공유하지 말아 주십시오.
          {e.contactName && <><br />문의: {e.department} {e.contactName}</>}
        </p>
      </div>
    </div>
  );
}

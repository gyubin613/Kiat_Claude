"use client";

import { useState } from "react";
import Link from "next/link";
import { STATUS_BADGE, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { api, errMsg, Modal, useConfirm, useToast, ApiError } from "@/components/ui";
import { formatDateKo, formatSlot } from "@/lib/util";
import { DEFAULT_FOLLOWUP, followupOf, type FollowupSettings, type Slot } from "@/lib/types";

type SlotDraft = { id?: string; date: string; start: string; end: string; place: string };
type Draft = {
  name: string;
  department: string;
  contactName: string;
  deadline: string;
  seats: number | string;
  requirements: string;
  slots: SlotDraft[];
  followup: FollowupSettings;
};

const emptyDraft = (): Draft => ({
  name: "",
  department: "",
  contactName: "",
  deadline: "",
  seats: 5,
  requirements: "",
  slots: [{ date: "", start: "10:00", end: "17:00", place: "" }],
  followup: { ...DEFAULT_FOLLOWUP },
});

function addDays(date: string, n: number) {
  if (!date) return "";
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function FollowupEditor({ value: f, onChange }: { value: FollowupSettings; onChange: (f: FollowupSettings) => void }) {
  const { meta } = useAdmin();
  const set = (p: Partial<FollowupSettings>) => onChange({ ...f, ...p });
  const preset = [24, 48, 72].includes(Number(f.hours));
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="card-body stack" style={{ gap: 10 }}>
        <label className="row strong">
          <input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          무응답 시 다음 순위 위원에게 자동 안내
        </label>
        <p className="small muted">초청 메일 발송 후 정한 기간 안에 참석·불참 회신이 없으면, 배석 인원이 부족한 만큼 우선순위 다음 위원을 자동으로 초청합니다. 기존 위원의 초청은 유지되어 늦게라도 회신할 수 있습니다.</p>
        {f.enabled && (
          <div className="stack" style={{ gap: 10, paddingLeft: 24 }}>
            <div className="row">
              <span className="small">회신 대기 기간</span>
              {[24, 48, 72].map((h) => (
                <button key={h} type="button" className={`btn sm ${Number(f.hours) === h ? "primary" : ""}`} onClick={() => set({ hours: h })}>
                  {h / 24}일({h}시간)
                </button>
              ))}
              <span className="small muted">직접 입력</span>
              <input className="input" style={{ width: 90 }} type="number" min={1} max={336} value={f.hours} onChange={(e) => set({ hours: e.target.value as unknown as number })} aria-label="회신 대기 시간" />
              <span className="small">시간 {!preset && f.hours ? `(약 ${(Number(f.hours) / 24).toFixed(1)}일)` : ""}</span>
            </div>
            <label className="row small"><input type="checkbox" checked={f.onDecline} onChange={(e) => set({ onDecline: e.target.checked })} /> &lsquo;참석 불가&rsquo; 회신이 오면 기간과 관계없이 바로 다음 순위 위원에게 안내</label>
            <label className="row small"><input type="checkbox" checked={f.autoSend} onChange={(e) => set({ autoSend: e.target.checked })} /> 초청 메일까지 자동 발송</label>
            {f.autoSend && !meta?.email.configured && (
              <div className="notice warn small">이메일 발송 서비스가 설정되지 않아 지금은 다음 순위 위원을 <b>초청 대상에 추가만</b> 하고, ④ 초청 메일 화면에 &lsquo;발송 필요&rsquo;로 표시합니다.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationForm({ initial, onClose }: { initial: EvalWithCounts | null; onClose: () => void }) {
  const { reload, setCurrentId } = useAdmin();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() =>
    initial
      ? {
          name: initial.name,
          department: initial.department,
          contactName: initial.contactName,
          deadline: initial.deadline,
          seats: initial.seats,
          requirements: initial.requirements,
          slots: initial.slots.map((s: Slot) => ({ ...s })),
          followup: followupOf(initial),
        }
      : emptyDraft(),
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));
  const setSlot = (i: number, patch: Partial<SlotDraft>) => set("slots", d.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    setErr("");
    const slots = d.slots.filter((s) => s.date);
    if (!d.name.trim()) return setErr("평가명을 입력해 주세요.");
    if (!d.deadline) return setErr("회신 기한을 입력해 주세요.");
    if (!slots.length) return setErr("후보 일정을 1개 이상 입력해 주세요.");
    const late = slots.find((s) => s.date < d.deadline);
    if (late) return setErr(`회신 기한(${d.deadline}) 이전의 후보 일정이 있습니다: ${late.date}`);
    setBusy(true);
    try {
      const payload = { ...d, seats: Number(d.seats), slots, followup: { ...d.followup, hours: Number(d.followup.hours) } };
      if (payload.followup.enabled && (!payload.followup.hours || payload.followup.hours < 1)) {
        setBusy(false);
        return setErr("자동 후속 안내 기간을 1시간 이상으로 설정해 주세요.");
      }
      if (initial) {
        // 변경된 항목만 전송
        const changed: Record<string, unknown> = {};
        (Object.keys(payload) as (keyof typeof payload)[]).forEach((k) => {
          const before = k === "slots" ? initial.slots : k === "followup" ? followupOf(initial) : initial[k];
          if (JSON.stringify(before) !== JSON.stringify(payload[k])) changed[k] = payload[k];
        });
        if (!Object.keys(changed).length) {
          onClose();
          return;
        }
        await api(`/api/admin/evaluations/${initial.id}`, { method: "PATCH", json: { ...changed, version: initial.version } });
        toast("평가 정보를 저장했습니다.", "ok");
        await reload();
      } else {
        const res = await api<{ evaluation: { id: string } }>("/api/admin/evaluations", { method: "POST", json: payload });
        await reload();
        setCurrentId(res.evaluation.id);
        toast("새 평가를 등록했습니다. 다음 단계에서 평가위원 명단을 확인하세요.", "ok");
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await reload();
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={initial ? "평가 정보 수정" : "새 평가 등록"}
      onClose={onClose}
      footer={
        <>
          {err && <span className="err" style={{ marginRight: "auto", color: "var(--bad)" }}>{err}</span>}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <div className="field full">
            <label>평가명 *</label>
            <input className="input" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="예) 2026년 ○○사업 신규과제 선정평가" />
          </div>
          <div className="field">
            <label>담당부서</label>
            <input className="input" value={d.department} onChange={(e) => set("department", e.target.value)} />
          </div>
          <div className="field">
            <label>운영 담당자</label>
            <input className="input" value={d.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="메일 서명에 사용됩니다" />
          </div>
          <div className="field">
            <label>회신 기한 *</label>
            <input className="input" type="date" value={d.deadline} onChange={(e) => set("deadline", e.target.value)} />
          </div>
          <div className="field">
            <label>평가위원 배석 인원 *</label>
            <input className="input" type="number" min={1} max={50} value={d.seats} onChange={(e) => set("seats", e.target.value)} />
          </div>
          <div className="field full">
            <label>참여 요청사항</label>
            <textarea className="textarea" value={d.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder="초청 메일과 회신 화면에 표시됩니다." />
          </div>
        </div>
        <FollowupEditor value={d.followup} onChange={(f) => set("followup", f)} />
        <div>
          <div className="row between" style={{ marginBottom: 8 }}>
            <h3>후보 일정 및 장소</h3>
            <button className="btn sm" onClick={() => set("slots", [...d.slots, { date: "", start: "10:00", end: "17:00", place: d.slots.at(-1)?.place ?? "" }])}>
              + 일정 추가
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>날짜</th>
                  <th>시작</th>
                  <th>종료</th>
                  <th>장소</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {d.slots.map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td><input className="input" type="date" value={s.date} onChange={(e) => setSlot(i, { date: e.target.value })} aria-label={`${i + 1}번 일정 날짜`} /></td>
                    <td><input className="input" type="time" value={s.start} onChange={(e) => setSlot(i, { start: e.target.value })} aria-label="시작 시간" /></td>
                    <td><input className="input" type="time" value={s.end} onChange={(e) => setSlot(i, { end: e.target.value })} aria-label="종료 시간" /></td>
                    <td><input className="input" value={s.place} onChange={(e) => setSlot(i, { place: e.target.value })} placeholder="회의실 등" aria-label="장소" /></td>
                    <td className="nowrap">
                      <button className="btn ghost sm" title="다음 날로 복사" onClick={() => set("slots", [...d.slots.slice(0, i + 1), { ...s, id: undefined, date: addDays(s.date, 1) }, ...d.slots.slice(i + 1)])}>
                        +1일
                      </button>
                      <button className="btn ghost sm" title="삭제" disabled={d.slots.length === 1} onClick={() => set("slots", d.slots.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function EvaluationsPage() {
  const { evaluations, current, setCurrentId, reload, checkFollowups, loading } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<EvalWithCounts | "new" | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function seed() {
    if (!(await confirm({ title: "가상 데이터 불러오기", message: "현재 저장된 모든 데이터를 지우고 시연용 가상 데이터(평가 3건, 평가위원 30명)를 불러옵니다. 계속할까요?", confirmText: "불러오기", danger: evaluations.length > 0 })))
      return;
    setSeeding(true);
    try {
      await api("/api/admin/seed", { method: "POST", json: { action: "seed" } });
      await reload();
      setCurrentId(null);
      toast("가상 데이터를 불러왔습니다.", "ok");
      checkFollowups(true);
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setSeeding(false);
    }
  }
  async function reset() {
    if (!(await confirm({ title: "전체 초기화", message: "모든 평가·평가위원·회신 데이터가 삭제됩니다. 되돌릴 수 없습니다.", confirmText: "모두 삭제", danger: true }))) return;
    await api("/api/admin/seed", { method: "POST", json: { action: "reset" } });
    await reload();
    setCurrentId(null);
    toast("모든 데이터를 삭제했습니다.", "ok");
  }
  async function remove(e: EvalWithCounts) {
    if (!(await confirm({ title: "평가 삭제", message: <>「{e.name}」과 관련된 초청·회신 기록이 모두 삭제됩니다.</>, confirmText: "삭제", danger: true }))) return;
    try {
      await api(`/api/admin/evaluations/${e.id}`, { method: "DELETE" });
      if (current?.id === e.id) setCurrentId(null);
      await reload();
      toast("평가를 삭제했습니다.", "ok");
    } catch (err) {
      toast(errMsg(err), "bad");
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>① 평가 일정 등록</h1>
          <p>평가별 기본정보와 후보 일정·장소를 등록합니다. 여러 평가를 각각 독립적으로 관리할 수 있습니다.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={seed} disabled={seeding}>{seeding ? "불러오는 중…" : "가상 데이터 불러오기"}</button>
          <button className="btn primary" onClick={() => setEditing("new")}>+ 새 평가 등록</button>
        </div>
      </div>

      {!loading && evaluations.length === 0 && (
        <div className="card">
          <div className="empty">
            <div className="strong">등록된 평가가 없습니다.</div>
            <div>새 평가를 등록하거나, 시연용 가상 데이터를 불러와 전체 업무 흐름을 바로 확인해 보세요.</div>
            <div className="row">
              <button className="btn" onClick={seed} disabled={seeding}>{seeding ? "불러오는 중…" : "가상 데이터 불러오기"}</button>
              <button className="btn primary" onClick={() => setEditing("new")}>+ 새 평가 등록</button>
            </div>
          </div>
        </div>
      )}

      {evaluations.map((e) => {
        const c = e.counts;
        const isCurrent = current?.id === e.id;
        return (
          <div key={e.id} className="card" style={isCurrent ? { borderColor: "var(--primary)", boxShadow: "0 0 0 2px var(--primary-soft)" } : undefined}>
            <div className="card-head">
              <div className="row">
                <h2>{e.name}</h2>
                <span className={`badge ${STATUS_BADGE[e.status].cls}`}>{STATUS_BADGE[e.status].label}</span>
                {isCurrent && <span className="badge dark">작업 중</span>}
              </div>
              <div className="row">
                {!isCurrent && <button className="btn sm" onClick={() => setCurrentId(e.id)}>이 평가로 작업</button>}
                <button className="btn sm" disabled={e.status === "finalized"} title={e.status === "finalized" ? "확정된 평가는 수정할 수 없습니다" : ""} onClick={() => setEditing(e)}>수정</button>
                <button className="btn sm danger" onClick={() => remove(e)}>삭제</button>
              </div>
            </div>
            <div className="card-body grid-2">
              <div className="stack" style={{ gap: 6 }}>
                <div><span className="muted">담당부서</span> {e.department || "-"} {e.contactName && <span className="muted">/ {e.contactName}</span>}</div>
                <div><span className="muted">회신 기한</span> {formatDateKo(e.deadline)} · <span className="muted">배석 인원</span> {e.seats}명</div>
                <div className="muted small">
                  후보 일정 {e.slots.length}건 · 자동 후속 안내{" "}
                  {followupOf(e).enabled ? <span className="badge info">{followupOf(e).hours}시간 무응답 시{followupOf(e).onDecline ? " · 불참 시" : ""}</span> : <span className="badge">꺼짐</span>}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {e.slots.map((s) => (
                    <li key={s.id} style={e.finalization?.slotId === s.id ? { fontWeight: 700, color: "var(--ok)" } : undefined}>
                      {formatSlot(s)} {e.finalization?.slotId === s.id && "← 확정"}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                <div className="stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                  <div className="stat"><div className="label">초청</div><div className="value">{c.total - c.withdrawn}</div></div>
                  <div className="stat ok"><div className="label">참석 가능</div><div className="value">{c.yes + c.conditional}</div></div>
                  <div className="stat warn"><div className="label">회신 대기</div><div className="value">{c.waiting + c.notSent}</div></div>
                  <div className="stat bad"><div className="label">불가·철회</div><div className="value">{c.no + c.withdrawn}</div></div>
                </div>
                <div className="row">
                  <Link className="btn sm" href={`/admin/priority?e=${e.id}`} >섭외 우선순위 →</Link>
                  <Link className="btn sm" href={`/admin/responses?e=${e.id}`} >회신 현황 →</Link>
                  <Link className="btn sm" href={`/admin/finalize?e=${e.id}`} >최종 확정 →</Link>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {evaluations.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn sm ghost" onClick={reset} style={{ color: "var(--bad)" }}>전체 데이터 초기화</button>
        </div>
      )}

      {editing && <EvaluationForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

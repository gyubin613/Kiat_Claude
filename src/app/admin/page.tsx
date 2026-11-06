"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STATUS_BADGE, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { RowMenu } from "@/components/ui";
import Today from "@/components/Today";
import { api, errMsg, Modal, useConfirm, useToast, ApiError } from "@/components/ui";
import { formatDateKo } from "@/lib/util";
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
  conflictKeywords: string;
  recruitMode: "manual" | "auto";
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
  conflictKeywords: "",
  recruitMode: "manual",
});

function addDays(date: string, n: number) {
  if (!date) return "";
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function RecruitModeOption({ value, running, onChange }: { value: "manual" | "auto"; running: boolean; onChange: (m: "manual" | "auto") => void }) {
  const { meta } = useAdmin();
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="card-body stack" style={{ gap: 10 }}>
        <h3>섭외 방식</h3>
        <div className="seg" role="radiogroup" aria-label="섭외 방식">
          <button type="button" className={value === "manual" ? "on" : ""} disabled={running} onClick={() => onChange("manual")} role="radio" aria-checked={value === "manual"}>직접 골라 초청</button>
          <button type="button" className={value === "auto" ? "on" : ""} disabled={running} onClick={() => onChange("auto")} role="radio" aria-checked={value === "auto"}>자동 섭외 (순서대로 자동 발송)</button>
        </div>
        <p className="small muted">
          {value === "auto"
            ? "우선순위 화면에서 위원 순서를 끌어서 정하고 [자동 섭외 시작]을 누르면, 배석 인원만큼 앞 순서부터 초청 메일이 바로 나갑니다. 불참 회신이 오면 즉시, 정한 시간 동안 회신이 없으면 다음 순서 위원에게 자동으로 보냅니다."
            : "우선순위 화면에서 위원을 골라 초청 대상에 넣고, 초청 메일 화면에서 직접 보냅니다."}
        </p>
        {running && <span className="small" style={{ color: "var(--warn)" }}>자동 섭외 진행 중에는 방식을 바꿀 수 없습니다. 우선순위 화면에서 먼저 중지해 주세요.</span>}
        {value === "auto" && !meta?.email.configured && (
          <div className="notice warn small">메일 설정이 아직 없습니다. 자동 섭외는 메일이 실제로 나가야 의미가 있으니, 시작 전에 메일 설정을 마쳐 주세요.</div>
        )}
      </div>
    </div>
  );
}

function FollowupEditor({ value: f, auto, onChange }: { value: FollowupSettings; auto?: boolean; onChange: (f: FollowupSettings) => void }) {
  const { meta } = useAdmin();
  const set = (p: Partial<FollowupSettings>) => onChange({ ...f, ...p });
  const preset = [24, 48, 72].includes(Number(f.hours));
  if (auto)
    return (
      <div className="card" style={{ boxShadow: "none" }}>
        <div className="card-body stack" style={{ gap: 10 }}>
          <h3>회신이 없을 때 다음 순서로 넘어가는 시간</h3>
          <div className="row">
            {[24, 48, 72].map((h) => (
              <button key={h} type="button" className={`btn sm ${Number(f.hours) === h ? "primary" : ""}`} onClick={() => set({ hours: h })}>
                {h / 24}일({h}시간)
              </button>
            ))}
            <span className="small muted">직접 입력</span>
            <input className="input" style={{ width: 90 }} type="number" min={1} max={336} value={f.hours} onChange={(e) => set({ hours: e.target.value as unknown as number })} aria-label="회신 대기 시간" />
            <span className="small">시간 {!preset && f.hours ? `(약 ${(Number(f.hours) / 24).toFixed(1)}일)` : ""}</span>
          </div>
          <p className="small muted">불참 회신은 시간과 관계없이 바로 다음 순서로 넘어갑니다.</p>
        </div>
      </div>
    );
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
              <div className="notice warn small">메일 설정 전이라 지금은 다음 순위 위원을 <b>초청 대상에 추가만</b> 하고, 초청 메일 화면에 &lsquo;발송 필요&rsquo;로 표시합니다.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type RosterChoice = { how: "new" | "copy"; from: string; mode: "all" | "pick" };

function RosterOption({ value: r, onChange }: { value: RosterChoice; onChange: (r: RosterChoice) => void }) {
  const { evaluations } = useAdmin();
  const sources = evaluations.filter((e) => e.rosterCount > 0);
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="card-body stack" style={{ gap: 10 }}>
        <h3>평가위원 명단</h3>
        <p className="small muted">평가마다 명단을 따로 둡니다. 새로 올리거나, 이전 평가의 명단을 불러와 쓸 수 있습니다.</p>
        <div className="seg" role="radiogroup" aria-label="평가위원 명단 준비 방법">
          <button type="button" className={r.how === "new" ? "on" : ""} onClick={() => onChange({ ...r, how: "new" })} role="radio" aria-checked={r.how === "new"}>새로 올리기 (엑셀·직접 입력)</button>
          <button type="button" className={r.how === "copy" ? "on" : ""} disabled={!sources.length} onClick={() => onChange({ ...r, how: "copy", from: r.from || sources[0]?.id || "" })} role="radio" aria-checked={r.how === "copy"}>이전 평가에서 불러오기</button>
        </div>
        {r.how === "copy" && (
          <div className="row">
            <select className="select" style={{ flex: 1, minWidth: 240 }} value={r.from} onChange={(e) => onChange({ ...r, from: e.target.value })} aria-label="불러올 평가">
              {sources.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.rosterCount}명)</option>
              ))}
            </select>
            <div className="seg" role="radiogroup" aria-label="불러오기 방식">
              <button type="button" className={r.mode === "all" ? "on" : ""} onClick={() => onChange({ ...r, mode: "all" })} role="radio" aria-checked={r.mode === "all"}>일괄</button>
              <button type="button" className={r.mode === "pick" ? "on" : ""} onClick={() => onChange({ ...r, mode: "pick" })} role="radio" aria-checked={r.mode === "pick"}>선택</button>
            </div>
          </div>
        )}
        {r.how === "copy" && <span className="hint small muted">{r.mode === "all" ? "등록과 함께 전체 위원을 불러옵니다. 이전 평가 참여 결과는 과거 이력에 반영됩니다." : "등록 후 위원 목록에서 불러올 위원을 체크해 고릅니다."}</span>}
      </div>
    </div>
  );
}

function EvaluationForm({ initial, onClose }: { initial: EvalWithCounts | null; onClose: () => void }) {
  const { reload } = useAdmin();
  const router = useRouter();
  const [roster, setRoster] = useState<RosterChoice>({ how: "new", from: "", mode: "all" });
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
          conflictKeywords: (initial.conflictKeywords ?? []).join(", "),
          recruitMode: initial.recruitMode ?? "manual",
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
      const payload = {
        ...d,
        seats: Number(d.seats),
        slots,
        followup: { ...d.followup, hours: Number(d.followup.hours) },
        conflictKeywords: [...new Set(d.conflictKeywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean))],
      };
      if (payload.followup.enabled && (!payload.followup.hours || payload.followup.hours < 1)) {
        setBusy(false);
        return setErr("자동 후속 안내 기간을 1시간 이상으로 설정해 주세요.");
      }
      if (initial) {
        // 변경된 항목만 전송
        const changed: Record<string, unknown> = {};
        (Object.keys(payload) as (keyof typeof payload)[]).forEach((k) => {
          const before =
            k === "slots"
              ? initial.slots
              : k === "followup"
                ? { ...DEFAULT_FOLLOWUP, ...(initial.followup ?? {}) }
                : k === "conflictKeywords"
                  ? initial.conflictKeywords ?? []
                  : k === "recruitMode"
                    ? initial.recruitMode ?? "manual"
                    : initial[k];
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
        const id = res.evaluation.id;
        let q = "";
        if (roster.how === "copy" && roster.from && roster.mode === "all") {
          const c = await api<{ results: { result: string }[] }>(`/api/admin/evaluations/${id}/evaluators/copy`, {
            method: "POST",
            json: { from: roster.from, ids: null, applyHistory: true },
          });
          toast(`새 평가를 등록하고 위원 ${c.results.filter((x) => x.result === "created").length}명을 불러왔습니다.`, "ok");
        } else if (roster.how === "copy" && roster.from) {
          q = `&load=${roster.from}&mode=pick`;
          toast("새 평가를 등록했습니다. 불러올 위원을 골라 주세요.", "ok");
        } else toast("새 평가를 등록했습니다. 위원 명단을 올려 주세요.", "ok");
        await reload();
        // 주소의 ?e= 로 현재 평가가 바뀌므로 setCurrentId 대신 한 번만 이동 (중복 주소 변경으로 이동이 덮이는 것 방지)
        router.push(`/admin/evaluators?e=${id}${q}`);
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
            <label>이해관계 확인 기관 (선택)</label>
            <input className="input" value={d.conflictKeywords} onChange={(e) => set("conflictKeywords", e.target.value)} placeholder="피평가 기관명을 쉼표로 구분해 입력 (예: 다온테크, 가온대학교)" />
            <span className="hint">위원의 소속·학사·최종학력 학교에 포함되면 위원 목록에 &lsquo;이해관계 확인&rsquo;으로 표시합니다. 우선순위 점수에는 반영하지 않습니다.</span>
          </div>
          <div className="field full">
            <label>참여 요청사항</label>
            <textarea className="textarea" value={d.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder="초청 메일과 회신 화면에 표시됩니다." />
          </div>
        </div>
        {!initial && <RosterOption value={roster} onChange={setRoster} />}
        <RecruitModeOption value={d.recruitMode} running={!!initial?.autoRunning} onChange={(m) => set("recruitMode", m)} />
        <FollowupEditor value={d.followup} auto={d.recruitMode === "auto"} onChange={(f) => set("followup", f)} />
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
      {current && <Today evaluation={current} />}

      <div className="page-head" style={{ marginTop: current ? 8 : 0 }}>
        <div>
          <h1>평가 목록</h1>
          <p>평가마다 후보 일정, 배석 인원, 자동 후속 안내를 따로 정합니다.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={seed} disabled={seeding}>{seeding ? "불러오는 중…" : "가상 데이터 불러오기"}</button>
          <button className="btn primary" onClick={() => setEditing("new")}>새 평가 등록</button>
        </div>
      </div>

      {!loading && evaluations.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="strong">등록된 평가가 없습니다.</div>
            <div>새 평가를 등록하거나, 가상 데이터로 전체 흐름을 먼저 확인해 보세요.</div>
          </div>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr><th>평가명</th><th>상태</th><th>회신 기한</th><th style={{ minWidth: 170 }}>확보 인원</th><th>섭외 방식</th><th></th></tr>
            </thead>
            <tbody>
              {evaluations.map((e) => {
                const isCurrent = current?.id === e.id;
                const got = e.status === "finalized" ? e.finalization?.members.length ?? 0 : e.counts.yes;
                const f = followupOf(e);
                return (
                  <tr key={e.id} className={isCurrent ? "selected" : ""}>
                    <td>
                      <div className="who">
                        <b>{e.name}</b>
                        <span>{[e.department, e.contactName].filter(Boolean).join(" ")} · 후보 일정 {e.slots.length}건 · 위원 명단 {e.rosterCount}명</span>
                      </div>
                    </td>
                    <td><span className={`badge ${STATUS_BADGE[e.status].cls}`}>{STATUS_BADGE[e.status].label}</span></td>
                    <td className="nowrap small">{formatDateKo(e.deadline)}</td>
                    <td>
                      <div className="progress">
                        <span className="small">{got} / {e.seats}명{e.counts.conditional ? ` · 조건부 ${e.counts.conditional}` : ""}</span>
                        <div className="bar"><span className="yes" style={{ width: `${Math.min(100, (got / e.seats) * 100)}%` }} /></div>
                      </div>
                    </td>
                    <td className="small">
                      {e.recruitMode === "auto" ? (
                        <span className={`badge ${e.autoRunning ? "ok" : "info"}`}>자동 섭외{e.autoRunning ? " 진행 중" : " (시작 전)"}</span>
                      ) : f.enabled ? (
                        `${f.hours}시간 후 다음 순위`
                      ) : (
                        <span className="faint">수동</span>
                      )}
                    </td>
                    <td className="nowrap" style={{ textAlign: "right" }}>
                      {!isCurrent && <button className="btn sm" onClick={() => setCurrentId(e.id)}>선택</button>}{" "}
                      <RowMenu
                        items={[
                          { label: "수정", disabled: e.status === "finalized", onClick: () => setEditing(e) },
                          { label: "삭제", danger: true, onClick: () => remove(e) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {evaluations.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn sm ghost" onClick={reset} style={{ color: "var(--bad)" }}>전체 데이터 초기화</button>
        </div>
      )}

      {editing && <EvaluationForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

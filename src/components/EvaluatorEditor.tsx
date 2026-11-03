"use client";

import { useState } from "react";
import type { Evaluator } from "@/lib/types";
import { api, ApiError, errMsg, Modal, useToast } from "./ui";

type FormVals = {
  name: string;
  org: string;
  email: string;
  phone: string;
  expertise: string;
  pastInvited: string;
  pastAttended: string;
  preference: string;
  note: string;
};
type Key = keyof FormVals;

const FIELDS: { key: Key; label: string; type?: string; full?: boolean; area?: boolean; hint?: string }[] = [
  { key: "name", label: "성명 *" },
  { key: "org", label: "소속기관" },
  { key: "email", label: "이메일", type: "email", hint: "초청 메일 발송 및 중복 확인 기준" },
  { key: "phone", label: "연락처" },
  { key: "expertise", label: "전문분야", full: true },
  { key: "pastInvited", label: "과거 초청 횟수", type: "number", hint: "비우면 '이력 없음'으로 중립 점수 적용" },
  { key: "pastAttended", label: "과거 참여 횟수", type: "number" },
  { key: "preference", label: "관리자 선호도 (1~5)", hint: "비우면 중립(3점)으로 계산" },
  { key: "note", label: "비고", full: true, area: true },
];

const toForm = (v: Partial<Evaluator> | null): FormVals => ({
  name: v?.name ?? "",
  org: v?.org ?? "",
  email: v?.email ?? "",
  phone: v?.phone ?? "",
  expertise: v?.expertise ?? "",
  pastInvited: v?.pastInvited == null ? "" : String(v.pastInvited),
  pastAttended: v?.pastAttended == null ? "" : String(v.pastAttended),
  preference: v?.preference == null ? "" : String(v.preference),
  note: v?.note ?? "",
});

const toValue = (k: Key, s: string) =>
  k === "pastInvited" || k === "pastAttended" || k === "preference" ? (s.trim() === "" ? null : Number(s)) : s.trim();

/**
 * 평가위원 정보 수정창 — 모든 항목을 한 화면에 표시하고, 바뀐 항목만 저장한다.
 */
export default function EvaluatorEditor({
  evaluator,
  onClose,
  onSaved,
}: {
  evaluator: Evaluator | null;
  onClose: () => void;
  onSaved: (v: Evaluator) => void;
}) {
  const toast = useToast();
  const [base, setBase] = useState<Evaluator | null>(evaluator);
  const [vals, setVals] = useState<FormVals>(() => toForm(evaluator));
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [dup, setDup] = useState<Evaluator | null>(null);
  const [busy, setBusy] = useState(false);
  const orig = toForm(base);
  const changed = (Object.keys(vals) as Key[]).filter((k) => vals[k].trim() !== orig[k].trim());

  async function save(allowDuplicate = false) {
    setErr("");
    setBusy(true);
    try {
      if (base) {
        if (!changed.length) return onClose();
        const patch = Object.fromEntries(changed.map((k) => [k, toValue(k, vals[k])]));
        const res = await api<{ evaluator: Evaluator }>(`/api/admin/evaluators/${base.id}`, {
          method: "PATCH",
          json: { ...patch, version: base.version },
        });
        toast(`${res.evaluator.name} 위원 정보 ${changed.length}개 항목을 저장했습니다.`, "ok");
        onSaved(res.evaluator);
      } else {
        const body = Object.fromEntries((Object.keys(vals) as Key[]).map((k) => [k, toValue(k, vals[k])]));
        const res = await api<{ evaluator: Evaluator }>("/api/admin/evaluators", { method: "POST", json: { ...body, allowDuplicate } });
        toast(`${res.evaluator.name} 위원을 등록했습니다.`, "ok");
        onSaved(res.evaluator);
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.current) {
        // 동시 수정 충돌: 최신 값으로 기준을 갱신하되 사용자가 바꾼 값은 유지
        const latest = e.data.current as Evaluator;
        const mine = Object.fromEntries(changed.map((k) => [k, vals[k]]));
        setBase(latest);
        setVals({ ...toForm(latest), ...mine });
        setNotice("다른 사용자가 이 위원 정보를 먼저 수정했습니다. 최신 정보로 갱신했으며, 변경하신 항목은 유지했습니다. 확인 후 다시 저장해 주세요.");
      } else if (e instanceof ApiError && e.status === 409 && e.data.duplicate && !base) {
        setDup(e.data.duplicate as Evaluator);
        setErr(e.message);
      } else setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={base ? `평가위원 정보 수정 — ${base.name}` : "평가위원 추가"}
      onClose={onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: "auto" }}>
            {base ? (changed.length ? `변경된 항목 ${changed.length}개만 저장됩니다.` : "변경된 항목이 없습니다.") : ""}
          </span>
          {dup && (
            <button className="btn" onClick={() => save(true)} disabled={busy}>
              중복이어도 등록
            </button>
          )}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={() => save()} disabled={busy || (!!base && !changed.length)}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <div className="stack">
        {notice && <div className="notice warn">{notice}</div>}
        {err && <div className="notice bad">{err}</div>}
        <div className="form-grid">
          {FIELDS.map((f) => {
            const isChanged = !!base && changed.includes(f.key);
            const props = {
              className: `${f.area ? "textarea" : "input"} ${isChanged ? "changed" : ""}`,
              value: vals[f.key],
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setVals((s) => ({ ...s, [f.key]: e.target.value })),
              id: `f-${f.key}`,
            };
            return (
              <div key={f.key} className={`field ${f.full ? "full" : ""}`}>
                <label htmlFor={props.id}>
                  {f.label} {isChanged && <span className="badge warn">변경</span>}
                </label>
                {f.area ? (
                  <textarea {...props} />
                ) : f.key === "preference" ? (
                  <select {...props} className={`select ${isChanged ? "changed" : ""}`}>
                    <option value="">미입력 (중립)</option>
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 5 ? "(매우 선호)" : n === 1 ? "(비선호)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input {...props} type={f.type ?? "text"} min={f.type === "number" ? 0 : undefined} />
                )}
                {isChanged && <span className="hint">기존 값: {orig[f.key] || "(비어 있음)"}</span>}
                {!isChanged && f.hint && <span className="hint">{f.hint}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

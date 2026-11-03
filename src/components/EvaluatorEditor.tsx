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
  bachelorSchool: string;
  bachelorMajor: string;
  bachelorAbroad: string;
  finalDegree: string;
  finalSchool: string;
  finalMajor: string;
  finalAbroad: string;
  overseasWorkYears: string;
  overseasWorkDetail: string;
};
type Key = keyof FormVals;

type Field = { key: Key; label: string; type?: string; full?: boolean; area?: boolean; hint?: string; options?: [string, string][] };
const YN: [string, string][] = [["", "미입력"], ["N", "국내"], ["Y", "해외"]];

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: "기본정보",
    fields: [
      { key: "name", label: "성명 *" },
      { key: "org", label: "소속기관" },
      { key: "email", label: "이메일", type: "email", hint: "초청 메일 발송 및 중복 확인 기준" },
      { key: "phone", label: "연락처" },
      { key: "expertise", label: "전문분야", full: true },
    ],
  },
  {
    title: "학력 (이해관계 확인용)",
    fields: [
      { key: "bachelorSchool", label: "학사 학교" },
      { key: "bachelorMajor", label: "학사 전공" },
      { key: "bachelorAbroad", label: "학사 국내/해외", options: YN },
      { key: "finalDegree", label: "최종학위", options: [["", "미입력"], ["학사", "학사"], ["석사", "석사"], ["박사", "박사"]] },
      { key: "finalSchool", label: "최종학력 학교" },
      { key: "finalMajor", label: "최종학력 전공" },
      { key: "finalAbroad", label: "최종학력 국내/해외", options: YN },
    ],
  },
  {
    title: "해외 근무 경력",
    fields: [
      { key: "overseasWorkYears", label: "해외 근무 기간 (년)", type: "number", hint: "없으면 0, 모르면 비워 두세요" },
      { key: "overseasWorkDetail", label: "근무 기관·내용" },
    ],
  },
  {
    title: "섭외 참고",
    fields: [
      { key: "pastInvited", label: "과거 초청 횟수", type: "number", hint: "비우면 '이력 없음'으로 중립 점수 적용" },
      { key: "pastAttended", label: "과거 참여 횟수", type: "number" },
      { key: "preference", label: "관리자 선호도", hint: "비우면 중립(3점)으로 계산", options: [["", "미입력 (중립)"], ["5", "5 (매우 선호)"], ["4", "4"], ["3", "3"], ["2", "2"], ["1", "1 (비선호)"]] },
      { key: "note", label: "비고", full: true, area: true },
    ],
  },
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
  bachelorSchool: v?.bachelorSchool ?? "",
  bachelorMajor: v?.bachelorMajor ?? "",
  bachelorAbroad: v?.bachelorAbroad == null ? "" : v.bachelorAbroad ? "Y" : "N",
  finalDegree: v?.finalDegree ?? "",
  finalSchool: v?.finalSchool ?? "",
  finalMajor: v?.finalMajor ?? "",
  finalAbroad: v?.finalAbroad == null ? "" : v.finalAbroad ? "Y" : "N",
  overseasWorkYears: v?.overseasWorkYears == null ? "" : String(v.overseasWorkYears),
  overseasWorkDetail: v?.overseasWorkDetail ?? "",
});

const toValue = (k: Key, s: string) => {
  if (k === "pastInvited" || k === "pastAttended" || k === "preference" || k === "overseasWorkYears") return s.trim() === "" ? null : Number(s);
  if (k === "bachelorAbroad" || k === "finalAbroad") return s === "" ? null : s === "Y";
  return s.trim();
};

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
      <div className="stack" style={{ gap: 18 }}>
        {notice && <div className="notice warn">{notice}</div>}
        {err && <div className="notice bad">{err}</div>}
        {SECTIONS.map((sec) => (
          <div key={sec.title}>
            <div className="section-title">{sec.title}</div>
            <div className="form-grid">
              {sec.fields.map((f) => {
                const isChanged = !!base && changed.includes(f.key);
                const id = `f-${f.key}`;
                const cls = `${isChanged ? "changed" : ""}`;
                const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                  setVals((s) => ({ ...s, [f.key]: e.target.value }));
                const label = f.options ? (o: string) => f.options!.find(([v]) => v === o)?.[1] ?? o : (o: string) => o;
                return (
                  <div key={f.key} className={`field ${f.full ? "full" : ""}`}>
                    <label htmlFor={id}>
                      {f.label} {isChanged && <span className="badge warn">변경</span>}
                    </label>
                    {f.area ? (
                      <textarea id={id} className={`textarea ${cls}`} value={vals[f.key]} onChange={onChange} />
                    ) : f.options ? (
                      <select id={id} className={`select ${cls}`} value={vals[f.key]} onChange={onChange}>
                        {f.options.map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    ) : (
                      <input id={id} className={`input ${cls}`} value={vals[f.key]} onChange={onChange} type={f.type ?? "text"} min={f.type === "number" ? 0 : undefined} step={f.key === "overseasWorkYears" ? 0.5 : undefined} />
                    )}
                    {isChanged && <span className="hint">기존 값: {label(orig[f.key]) || "(비어 있음)"}</span>}
                    {!isChanged && f.hint && <span className="hint">{f.hint}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

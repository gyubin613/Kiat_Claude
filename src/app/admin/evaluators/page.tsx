"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import EvaluatorEditor from "@/components/EvaluatorEditor";
import { useAdmin } from "@/components/AdminShell";
import { api, download, Empty, errMsg, Modal, RowMenu, useConfirm, useToast } from "@/components/ui";
import { bachelorText, educationMissing, finalText, overseasTags } from "@/lib/profile";
import type { Evaluator } from "@/lib/types";

type PreviewRow = {
  row: number;
  ok: boolean;
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
  duplicate: { by: "email" | "nameOrg"; name: string; org: string } | null;
};
type ResultRow = { row: number; name: string; result: "created" | "updated" | "skipped" | "error"; message?: string };

const RESULT_LABEL = { created: ["신규 등록", "ok"], updated: ["정보 보완", "info"], skipped: ["건너뜀", ""], error: ["오류", "bad"] } as const;

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"skip" | "fill" | "overwrite">("fill");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    if (dryRun) fd.append("dryRun", "1");
    try {
      const res = await api<{ preview?: PreviewRow[]; unmatchedHeaders?: string[]; results?: ResultRow[] }>("/api/admin/evaluators/import", {
        method: "POST",
        body: fd,
      });
      if (dryRun) {
        setPreview(res.preview ?? []);
        setUnmatched(res.unmatchedHeaders ?? []);
      } else {
        setResults(res.results ?? []);
        const n = (res.results ?? []).filter((r) => r.result === "created").length;
        toast(`엑셀 등록 완료: 신규 ${n}명`, "ok");
        onDone();
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const stats = preview && {
    total: preview.length,
    invalid: preview.filter((r) => !r.ok).length,
    dup: preview.filter((r) => r.ok && r.duplicate).length,
    fresh: preview.filter((r) => r.ok && !r.duplicate).length,
    warn: preview.filter((r) => r.warnings.length).length,
  };

  return (
    <Modal
      size="lg"
      title="엑셀 파일로 평가위원 일괄 등록"
      onClose={onClose}
      footer={
        results ? (
          <button className="btn primary" onClick={onClose}>닫기</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>취소</button>
            {!preview ? (
              <button className="btn primary" disabled={!file || busy} onClick={() => send(true)}>{busy ? "확인 중…" : "내용 확인"}</button>
            ) : (
              <button className="btn primary" disabled={busy || !stats || stats.total === stats.invalid} onClick={() => send(false)}>
                {busy ? "등록 중…" : `등록하기 (${stats!.total - stats!.invalid}행)`}
              </button>
            )}
          </>
        )
      }
    >
      <div className="stack">
        {!results && (
          <>
            <div className="notice">
              1행에 머리글이 있는 .xlsx 파일을 올려 주세요. 기본정보 외에 학사·최종학력, 해외 여부(Y/N), 해외 근무 경력(년)도 읽습니다.
              <b> 성명</b>만 필수이며, 비어 있는 항목은 등록 후 보완할 수 있습니다.{" "}
              <button className="btn sm" onClick={() => download("/api/admin/evaluators/template")}>등록 양식 내려받기</button>
            </div>
            <div className="row">
              <input
                type="file"
                accept=".xlsx"
                aria-label="엑셀 파일 선택"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
              <span className="spacer" />
              <label className="small muted" htmlFor="dupmode">이미 등록된 위원(중복)은</label>
              <select id="dupmode" className="select" style={{ width: 220 }} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="skip">건너뛰기</option>
                <option value="fill">빈 항목만 보완</option>
                <option value="overwrite">파일 내용으로 덮어쓰기</option>
              </select>
            </div>
          </>
        )}
        {err && <div className="notice bad">{err}</div>}
        {unmatched.length > 0 && !results && <div className="notice warn">인식하지 못한 열은 제외됩니다: {unmatched.join(", ")}</div>}
        {stats && !results && (
          <div className="stats">
            <div className="stat"><div className="label">전체 행</div><div className="value">{stats.total}</div></div>
            <div className="stat ok"><div className="label">신규</div><div className="value">{stats.fresh}</div></div>
            <div className="stat warn"><div className="label">중복(기존 위원)</div><div className="value">{stats.dup}</div></div>
            <div className="stat bad"><div className="label">오류(등록 불가)</div><div className="value">{stats.invalid}</div></div>
          </div>
        )}
        {preview && !results && (
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table className="table">
              <thead><tr><th>행</th><th>성명</th><th>소속</th><th>이메일</th><th>판정</th><th>확인사항</th></tr></thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.raw.name}</td>
                    <td>{r.raw.org}</td>
                    <td className="small">{r.raw.email}</td>
                    <td>
                      {!r.ok ? <span className="badge bad">오류</span> : r.duplicate ? <span className="badge warn">{r.duplicate.by === "email" ? "이메일 중복" : "성명·소속 중복"}</span> : <span className="badge ok">신규</span>}
                    </td>
                    <td className="small">
                      {[...r.errors, ...r.warnings, ...(r.duplicate ? [`기존: ${r.duplicate.name}(${r.duplicate.org || "-"})`] : [])].join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {results && (
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead><tr><th>행</th><th>성명</th><th>결과</th><th>내용</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.name}</td>
                    <td><span className={`badge ${RESULT_LABEL[r.result][1]}`}>{RESULT_LABEL[r.result][0]}</span></td>
                    <td className="small">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function EvaluatorsPage() {
  const { reload: reloadShell } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Evaluator[] | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Evaluator | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ evaluators: Evaluator[] }>("/api/admin/evaluators");
    setList(r.evaluators);
  }, []);
  useEffect(() => {
    load().catch((e) => toast(errMsg(e), "bad"));
  }, [load, toast]);

  const incomplete = (v: Evaluator) => !v.email || !v.org || !v.phone || educationMissing(v);
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (list ?? []).filter(
      (v) =>
        (!onlyIncomplete || incomplete(v)) &&
        (!k || [v.name, v.org, v.email, v.expertise, v.note, v.bachelorSchool, v.finalSchool].some((s) => s.toLowerCase().includes(k))),
    );
  }, [list, q, onlyIncomplete]);

  async function remove(v: Evaluator) {
    if (!(await confirm({ title: "평가위원 삭제", message: `${v.name}(${v.org || "소속 미입력"}) 위원을 명단에서 삭제할까요?`, confirmText: "삭제", danger: true }))) return;
    try {
      await api(`/api/admin/evaluators/${v.id}`, { method: "DELETE" });
      toast("삭제했습니다.", "ok");
      await load();
      reloadShell();
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>평가위원 명단</h1>
          <p>엑셀로 한꺼번에 등록하고, 바뀐 항목만 골라 수정합니다.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => download("/api/admin/evaluators/export")} disabled={!list?.length}>엑셀 내보내기</button>
          <button className="btn" onClick={() => setImporting(true)}>엑셀 일괄 등록</button>
          <button className="btn primary" onClick={() => setEditing("new")}>+ 위원 추가</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="row" style={{ flex: 1 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="성명·소속·학교·전문분야 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="평가위원 검색" />
            <label className="row small">
              <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} /> 정보 보완 필요만 보기
            </label>
          </div>
          <span className="muted small">{list ? `${filtered.length} / ${list.length}명` : ""}</span>
        </div>
        {list && list.length === 0 ? (
          <Empty title="등록된 평가위원이 없습니다.">
            <div className="row">
              <button className="btn" onClick={() => setImporting(true)}>엑셀 일괄 등록</button>
              <button className="btn primary" onClick={() => setEditing("new")}>+ 위원 추가</button>
            </div>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>위원</th><th>연락처</th><th>학사</th><th>최종학력</th><th>해외경험</th>
                  <th className="num">초청/참여</th><th className="num">선호도</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <div className="who">
                        <b>{v.name}</b>
                        <span>{v.org || <span className="badge warn">소속 미입력</span>}</span>
                        {v.expertise && <span className="faint">{v.expertise}</span>}
                      </div>
                    </td>
                    <td className="small">
                      <div>{v.email || <span className="badge warn">이메일 미입력</span>}</div>
                      <div className="muted">{v.phone}</div>
                    </td>
                    <td className="small">{bachelorText(v) || <span className="faint">미입력</span>}</td>
                    <td className="small">{finalText(v) || (v.bachelorSchool ? <span className="faint">학사와 동일</span> : <span className="faint">미입력</span>)}</td>
                    <td>
                      <div className="tags">
                        {overseasTags(v).map((t) => <span key={t} className="badge info">{t}</span>)}
                        {!overseasTags(v).length && <span className="faint small">{v.overseasWorkYears == null && v.bachelorAbroad == null && v.finalAbroad == null ? "미입력" : "없음"}</span>}
                      </div>
                    </td>
                    <td className="num">{v.pastInvited == null ? <span className="faint">-</span> : `${v.pastInvited}/${v.pastAttended ?? 0}`}</td>
                    <td className="num">{v.preference ?? <span className="faint">-</span>}</td>
                    <td className="nowrap" style={{ textAlign: "right" }}>
                      <button className="btn sm" onClick={() => setEditing(v)}>수정</button>{" "}
                      <RowMenu items={[{ label: "삭제", danger: true, onClick: () => remove(v) }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EvaluatorEditor
          evaluator={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            load();
            reloadShell();
          }}
        />
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={() => {
            load();
            reloadShell();
          }}
        />
      )}
    </div>
  );
}

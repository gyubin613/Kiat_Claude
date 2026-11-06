"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import EvaluatorEditor from "@/components/EvaluatorEditor";
import { NeedEvaluation, useAdmin, type EvalWithCounts } from "@/components/AdminShell";
import { api, download, errMsg, Modal, RowMenu, useConfirm, useToast } from "@/components/ui";
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

function ImportDialog({ evaluationId, hasRoster, onClose, onDone }: { evaluationId: string; hasRoster: boolean; onClose: () => void; onDone: () => void }) {
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
      const res = await api<{ preview?: PreviewRow[]; unmatchedHeaders?: string[]; results?: ResultRow[] }>(`/api/admin/evaluations/${evaluationId}/evaluators/import`, {
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
      title={hasRoster ? "엑셀로 명단 추가·업데이트" : "엑셀로 명단 올리기"}
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
              <label className="small muted" htmlFor="dupmode">이 평가 명단에 이미 있는 위원은</label>
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

type Source = { id: string; name: string; status: string; createdAt: string; count: number };

/** 이전 평가(또는 이전 버전 공통 명단)에서 위원을 일괄 또는 선택해 불러오기 */
function CopyDialog({
  evaluationId,
  initialFrom,
  initialMode = "all",
  onClose,
  onDone,
}: {
  evaluationId: string;
  initialFrom?: string | null;
  initialMode?: "all" | "pick";
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [from, setFrom] = useState<string>(initialFrom ?? "");
  const [mode, setMode] = useState<"all" | "pick">(initialMode);
  const [list, setList] = useState<Evaluator[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [applyHistory, setApplyHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; result: "created" | "skipped"; message?: string }[] | null>(null);

  useEffect(() => {
    api<{ sources: Source[] }>(`/api/admin/evaluations/${evaluationId}/evaluators/copy`)
      .then((r) => {
        setSources(r.sources);
        if ((!initialFrom || !r.sources.some((x) => x.id === initialFrom)) && r.sources[0]) setFrom(r.sources[0].id);
      })
      .catch((e) => toast(errMsg(e), "bad"));
  }, [evaluationId, initialFrom, toast]);

  useEffect(() => {
    if (!from) return;
    let alive = true;
    setList(null);
    setPicked(new Set());
    api<{ evaluators: Evaluator[] }>(from === "legacy" ? "/api/admin/evaluators" : `/api/admin/evaluations/${from}/evaluators`)
      .then((r) => alive && setList(r.evaluators))
      .catch((e) => {
        if (!alive) return;
        setList([]);
        toast(errMsg(e), "bad");
      });
    return () => {
      alive = false;
    };
  }, [from, toast]);

  const visible = (list ?? []).filter((v) => !q || [v.name, v.org, v.expertise].some((x) => x.includes(q)));
  const count = mode === "all" ? list?.length ?? 0 : picked.size;
  const src = sources?.find((x) => x.id === from);

  async function run() {
    setBusy(true);
    try {
      const r = await api<{ results: NonNullable<typeof results> }>(`/api/admin/evaluations/${evaluationId}/evaluators/copy`, {
        method: "POST",
        json: { from, ids: mode === "all" ? null : [...picked], applyHistory: from !== "legacy" && applyHistory },
      });
      setResults(r.results);
      const n = r.results.filter((x) => x.result === "created").length;
      toast(`${n}명을 이 평가 명단에 불러왔습니다.${r.results.length - n ? ` (이미 있는 ${r.results.length - n}명 제외)` : ""}`, "ok");
      onDone();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      size="lg"
      title="이전 평가에서 위원 불러오기"
      onClose={onClose}
      footer={
        results ? (
          <button className="btn primary" onClick={onClose}>닫기</button>
        ) : (
          <>
            <span className="small muted" style={{ marginRight: "auto" }}>불러온 위원은 이 평가 명단에 따로 저장되어, 고쳐도 원래 평가에는 영향이 없습니다.</span>
            <button className="btn" onClick={onClose}>취소</button>
            <button className="btn primary" disabled={busy || !from || !count} onClick={run}>
              {busy ? "불러오는 중…" : mode === "all" ? `${count}명 모두 불러오기` : `선택한 ${count}명 불러오기`}
            </button>
          </>
        )
      }
    >
      {results ? (
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="table">
            <thead><tr><th>성명</th><th>결과</th></tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.result === "created" ? <span className="badge ok">불러옴</span> : <span className="badge">{r.message ?? "건너뜀"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : sources && !sources.length ? (
        <div className="empty">불러올 수 있는 이전 평가 명단이 없습니다. 엑셀로 명단을 올려 주세요.</div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 260 }}>
              <label htmlFor="copy-from">불러올 평가</label>
              <select id="copy-from" className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
                {(sources ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.count}명{x.status === "finalized" ? " · 확정 완료" : ""})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>방식</label>
              <div className="seg" role="radiogroup" aria-label="불러오기 방식">
                <button className={mode === "all" ? "on" : ""} onClick={() => setMode("all")} role="radio" aria-checked={mode === "all"}>일괄 (전체)</button>
                <button className={mode === "pick" ? "on" : ""} onClick={() => setMode("pick")} role="radio" aria-checked={mode === "pick"}>선택</button>
              </div>
            </div>
          </div>
          {from !== "legacy" && (
            <label className="row small">
              <input type="checkbox" checked={applyHistory} onChange={(e) => setApplyHistory(e.target.checked)} />
              「{src?.name}」 결과를 과거 이력에 반영 (초청 메일을 받은 위원은 초청 +1, 최종 확정 위원은 참여 +1)
            </label>
          )}
          {mode === "pick" && (
            <div className="row">
              <input className="input" style={{ maxWidth: 260 }} placeholder="이름·소속·전문분야 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="불러올 위원 검색" />
              <button className="btn sm" onClick={() => setPicked(new Set([...picked, ...visible.map((v) => v.id)]))}>보이는 위원 모두 선택</button>
              {picked.size > 0 && <button className="btn sm ghost" onClick={() => setPicked(new Set())}>선택 해제</button>}
            </div>
          )}
          <div className="table-wrap" style={{ maxHeight: 360, border: "1px solid var(--line)", borderRadius: 8 }}>
            {!list ? (
              <div className="empty">불러오는 중…</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>{mode === "pick" && <th></th>}<th>위원</th><th>학력</th><th className="num">초청/참여</th><th className="num">선호</th></tr>
                </thead>
                <tbody>
                  {(mode === "pick" ? visible : list).map((v) => {
                    const on = picked.has(v.id);
                    const toggle = () => setPicked((p) => { const n = new Set(p); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; });
                    return (
                      <tr key={v.id} className={mode === "pick" && on ? "selected" : ""} style={{ cursor: mode === "pick" ? "pointer" : "default" }} onClick={() => mode === "pick" && toggle()}>
                        {mode === "pick" && (
                          <td><input type="checkbox" checked={on} onChange={toggle} onClick={(e) => e.stopPropagation()} aria-label={`${v.name} 선택`} /></td>
                        )}
                        <td><div className="who"><b>{v.name}</b><span>{v.org}{v.expertise ? ` · ${v.expertise}` : ""}</span></div></td>
                        <td className="small">{finalText(v) || bachelorText(v) || <span className="faint">미입력</span>}</td>
                        <td className="num">{v.pastInvited == null ? "-" : `${v.pastInvited}/${v.pastAttended ?? 0}`}</td>
                        <td className="num">{v.preference ?? "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Roster({ evaluation }: { evaluation: EvalWithCounts }) {
  const { reload: reloadShell } = useAdmin();
  const search = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Evaluator[] | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Evaluator | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [copying, setCopying] = useState<{ from: string | null; mode: "all" | "pick" } | null>(() =>
    search.get("load") ? { from: search.get("load") === "1" ? null : search.get("load"), mode: search.get("mode") === "pick" ? "pick" : "all" } : null,
  );
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const locked = evaluation.status === "finalized";

  const load = useCallback(async () => {
    const [r, i] = await Promise.all([
      api<{ evaluators: Evaluator[] }>(`/api/admin/evaluations/${evaluation.id}/evaluators`),
      api<{ invites: { evaluatorId: string }[] }>(`/api/admin/evaluations/${evaluation.id}/invites`),
    ]);
    setList(r.evaluators);
    setInvited(new Set(i.invites.map((x) => x.evaluatorId)));
  }, [evaluation.id]);
  useEffect(() => {
    load().catch((e) => toast(errMsg(e), "bad"));
  }, [load, toast]);
  const changed = () => {
    load();
    reloadShell();
  };

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
    if (!(await confirm({ title: "명단에서 빼기", message: `${v.name}(${v.org || "소속 미입력"}) 위원을 이 평가 명단에서 뺄까요? 다른 평가 명단에는 영향이 없습니다.`, confirmText: "빼기", danger: true }))) return;
    try {
      await api(`/api/admin/evaluations/${evaluation.id}/evaluators/${v.id}`, { method: "DELETE" });
      toast("명단에서 뺐습니다.", "ok");
      changed();
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  }

  const empty = list !== null && list.length === 0;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>평가위원 명단</h1>
          <p>「{evaluation.name}」에서 섭외할 위원 명단입니다. 평가마다 따로 관리됩니다.</p>
        </div>
        {!empty && (
          <div className="row">
            <button className="btn" onClick={() => download(`/api/admin/evaluations/${evaluation.id}/evaluators/export`)}>엑셀 다운로드</button>
            {!locked && <button className="btn" onClick={() => setCopying({ from: null, mode: "all" })}>이전 평가에서 불러오기</button>}
            {!locked && <button className="btn" onClick={() => setImporting(true)}>엑셀로 추가·업데이트</button>}
            {!locked && <button className="btn primary" onClick={() => setEditing("new")}>위원 추가</button>}
          </div>
        )}
      </div>

      {empty ? (
        <div className="card">
          <div className="card-body stack" style={{ gap: 14 }}>
            <h2>이 평가의 위원 명단을 만들어 주세요</h2>
            <div className="grid-3">
              <button className="choice" onClick={() => setCopying({ from: null, mode: "all" })} disabled={locked}>
                <span><b>이전 평가에서 불러오기</b><br /><span className="small muted">지난 평가 명단을 일괄로, 또는 원하는 위원만 골라 불러옵니다.</span></span>
              </button>
              <button className="choice" onClick={() => setImporting(true)} disabled={locked}>
                <span><b>엑셀로 새로 올리기</b><br /><span className="small muted">등록 양식이나 다른 평가에서 내려받아 고친 파일을 올립니다.</span></span>
              </button>
              <button className="choice" onClick={() => setEditing("new")} disabled={locked}>
                <span><b>직접 입력</b><br /><span className="small muted">위원을 한 명씩 추가합니다.</span></span>
              </button>
            </div>
          </div>
        </div>
      ) : (
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
                        <b>{v.name}{invited.has(v.id) && <span className="badge info" style={{ marginLeft: 6 }}>초청함</span>}</b>
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
                      {!locked && <RowMenu items={[{ label: "명단에서 빼기", danger: true, disabled: invited.has(v.id), onClick: () => remove(v) }]} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <EvaluatorEditor evaluationId={evaluation.id} evaluator={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={changed} />
      )}
      {importing && <ImportDialog evaluationId={evaluation.id} hasRoster={!empty} onClose={() => setImporting(false)} onDone={changed} />}
      {copying && (
        <CopyDialog evaluationId={evaluation.id} initialFrom={copying.from} initialMode={copying.mode} onClose={() => setCopying(null)} onDone={changed} />
      )}
    </div>
  );
}

export default function EvaluatorsPage() {
  return (
    <NeedEvaluation>
      {(e) => (
        <Suspense>
          <Roster key={e.id} evaluation={e} />
        </Suspense>
      )}
    </NeedEvaluation>
  );
}

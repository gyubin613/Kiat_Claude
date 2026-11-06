"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AiClassifyRequest, AiClassifyResult } from "@/lib/ai/classify";
import { buildWorkbook, buildZip, exportBaseName } from "@/lib/exporter";
import { parseAll, type LoadedFile } from "@/lib/mail";
import { matchAll, matchMail, stripQuoted } from "@/lib/matcher";
import { planFiles, projectStatus, STATUS_LABEL } from "@/lib/organize";
import { rowsToProjects } from "@/lib/projects";
import { readSheet } from "@/lib/readSheet";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { MailResult, MatchStatus, ParsedMail, Project } from "@/lib/types";
import { Detail } from "./Detail";
import { Dropzone } from "./Dropzone";
import { Ledger } from "./Ledger";
import { StatusMatrix } from "./StatusMatrix";

type Filter = "all" | MatchStatus;
const TAB_ORDER: Filter[] = ["all", "auto", "confirmed", "review", "unmatched", "excluded"];

function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function fetchSample(path: string): Promise<LoadedFile> {
  const r = await fetch(encodeURI(path));
  if (!r.ok) throw new Error(`가상 데이터를 불러오지 못했습니다 (${r.status})`);
  return { name: decodeURI(path.split("/").pop()!), bytes: new Uint8Array(await r.arrayBuffer()) };
}

interface AiStatus {
  enabled: boolean;
  label: string;
  passwordRequired: boolean;
}

export default function App() {
  const settings = DEFAULT_SETTINGS;
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectInfo, setProjectInfo] = useState<{ name: string; warnings: string[] } | null>(null);
  const [mails, setMails] = useState<ParsedMail[]>([]);
  const [mailInfo, setMailInfo] = useState<{ names: string; errors: string[]; skipped: string[] } | null>(null);
  const [results, setResults] = useState<MailResult[]>([]);
  const [view, setView] = useState<"ledger" | "status">("ledger");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [password, setPassword] = useState("");
  const [aiBusy, setAiBusy] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then(setAi)
      .catch(() => setAi({ enabled: false, label: "AI 미설정", passwordRequired: false }));
    try {
      setPassword(sessionStorage.getItem("app-pw") || "");
    } catch {
      /* 저장소를 쓸 수 없는 환경 */
    }
  }, []);

  // 과제 목록이나 메일이 바뀌면 다시 매칭하되, 담당자가 고친 결과는 유지
  useEffect(() => {
    if (!mails.length) {
      setResults([]);
      return;
    }
    const fresh = matchAll(mails, projects, settings);
    setResults((prev) => {
      const kept = new Map(prev.filter((r) => r.edited || r.aiAssisted).map((r) => [r.mailId, r]));
      return fresh.map((r) => {
        const k = kept.get(r.mailId);
        if (!k) return r;
        if (k.projectId && !projects.some((p) => p.id === k.projectId)) return r;
        return k;
      });
    });
  }, [mails, projects, settings]);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const mailsById = useMemo(() => new Map(mails.map((m) => [m.id, m])), [mails]);

  const loadProjects = async (files: LoadedFile[]) => {
    const f = files[0];
    if (!f) return;
    try {
      setBusy("과제 목록을 읽는 중");
      const rows = await readSheet(f.bytes, f.name);
      const { projects: ps, warnings } = rowsToProjects(rows);
      if (!ps.length) {
        setProjectInfo({ name: f.name, warnings });
        return;
      }
      setProjects(ps);
      setProjectInfo({ name: f.name, warnings });
    } catch (e) {
      setProjectInfo({ name: f.name, warnings: [`파일을 읽지 못했습니다: ${(e as Error).message}`] });
    } finally {
      setBusy(null);
    }
  };

  const loadMails = async (files: LoadedFile[]) => {
    if (!files.length) return;
    try {
      setBusy("메일을 읽는 중");
      const { mails: ms, errors, skipped } = await parseAll(files);
      setResults([]);
      setMails(ms);
      setSelected(null);
      setFilter("all");
      setMailInfo({ names: files.map((f) => f.name).join(", "), errors, skipped });
    } catch (e) {
      setMailInfo({ names: files.map((f) => f.name).join(", "), errors: [(e as Error).message], skipped: [] });
    } finally {
      setBusy(null);
    }
  };

  const loadSamples = async (which: "projects" | "mails" | "both") => {
    try {
      if (which !== "mails") await loadProjects([await fetchSample("/samples/과제목록_가상.xlsx")]);
      if (which !== "projects") await loadMails([await fetchSample("/samples/가상메일.zip")]);
    } catch (e) {
      say((e as Error).message);
    }
  };

  const update = (mailId: string, fn: (r: MailResult) => MailResult) =>
    setResults((rs) => rs.map((r) => (r.mailId === mailId ? fn(r) : r)));

  const assign = (mailId: string, projectId: string | null) =>
    update(mailId, (r) => ({
      ...r,
      projectId,
      relevant: true,
      status: projectId ? "confirmed" : "unmatched",
      edited: true,
    }));

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: results.length, auto: 0, confirmed: 0, review: 0, unmatched: 0, excluded: 0 };
    for (const r of results) c[r.status] += 1;
    return c;
  }, [results]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return results
      .filter((r) => filter === "all" || r.status === filter)
      .map((r) => ({ mail: mailsById.get(r.mailId)!, result: r }))
      .filter(({ mail, result }) => {
        if (!mail) return false;
        if (!q) return true;
        const p = result.projectId ? projectsById.get(result.projectId) : undefined;
        return [mail.subject, mail.fromName, mail.fromAddress, p?.id, p?.name, p?.partnerOrg, ...mail.attachments.map((a) => a.filename)]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q));
      });
  }, [results, filter, query, mailsById, projectsById]);

  const status = useMemo(() => projectStatus(mails, results, projects, settings), [mails, results, projects, settings]);

  const askAi = async (mailId: string) => {
    const mail = mailsById.get(mailId);
    const r = results.find((x) => x.mailId === mailId);
    if (!mail || !r) return;
    const candIds = r.candidates.map((c) => c.projectId);
    const cands = (candIds.length ? candIds.map((id) => projectsById.get(id)!).filter(Boolean) : projects).slice(0, 80);
    const req: AiClassifyRequest = {
      mail: {
        subject: mail.subject,
        fromName: mail.fromName,
        fromAddress: mail.fromAddress,
        date: mail.date,
        body: stripQuoted(mail.text).slice(0, 4000),
        attachments: mail.attachments.map((a) => a.filename),
      },
      candidates: cands.map((p) => ({ id: p.id, name: p.name, leadOrg: p.leadOrg, partnerOrg: p.partnerOrg, country: p.country })),
      docTypes: settings.requiredDocs,
    };
    setAiBusy((s) => new Set(s).add(mailId));
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(password ? { "x-app-password": password } : {}) },
        body: JSON.stringify(req),
      });
      const data = (await res.json()) as AiClassifyResult & { error?: string };
      if (!res.ok) throw new Error(data.error || `오류 ${res.status}`);
      update(mailId, (cur) => ({
        ...cur,
        projectId: data.projectId ?? cur.projectId,
        status: data.projectId ? (data.confidence >= 85 ? "auto" : "review") : cur.status,
        confidence: data.projectId ? data.confidence : cur.confidence,
        reasons: data.reason ? [...cur.reasons.filter((x) => !x.startsWith("AI:")), `AI: ${data.reason}`] : cur.reasons,
        summary: data.summary || cur.summary,
        attachments: cur.attachments.map((a, i) =>
          a.docType === "기타" && data.attachmentTypes[i] && data.attachmentTypes[i] !== "기타"
            ? { ...a, docType: data.attachmentTypes[i], docReason: "AI 판단" }
            : a,
        ),
        aiAssisted: true,
      }));
    } catch (e) {
      say(`AI 판단 실패: ${(e as Error).message}`);
    } finally {
      setAiBusy((s) => {
        const n = new Set(s);
        n.delete(mailId);
        return n;
      });
    }
  };

  const askAiAll = async () => {
    const targets = results.filter((r) => (r.status === "review" || r.status === "unmatched") && !r.aiAssisted);
    if (!targets.length) return say("AI에게 맡길 메일이 없습니다.");
    for (const t of targets) await askAi(t.mailId);
    say(`${targets.length}통을 AI가 다시 판단했습니다. 결과를 확인해 주세요.`);
  };

  const exportExcel = async () => {
    setBusy("엑셀을 만드는 중");
    try {
      const input = { mails, results, projects, settings };
      const bytes = await buildWorkbook(input, planFiles(mails, results, projects));
      download(bytes, `${exportBaseName()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } finally {
      setBusy(null);
    }
  };

  const exportZip = async () => {
    setBusy("폴더를 정리하는 중");
    try {
      const { zip, plan } = await buildZip({ mails, results, projects, settings });
      download(zip, `${exportBaseName()}.zip`, "application/zip");
      say(`파일 ${plan.length}개를 과제별 폴더로 정리했습니다.`);
    } finally {
      setBusy(null);
    }
  };

  const sel = selected ? { mail: mailsById.get(selected), result: results.find((r) => r.mailId === selected) } : null;
  const remaining = counts.review + counts.unmatched;

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div>
            <h1 className="title">과제 서류 메일 정리 도우미</h1>
            <p className="subtitle">
              메일로 받은 제출 서류를 과제 목록에 맞춰 분류하고, 제출현황 엑셀과 과제별 폴더로 정리합니다.
            </p>
          </div>
          <div className="privacy">
            올린 파일은 이 브라우저 안에서만 처리되고 서버에 저장되지 않습니다. AI 판단을 쓰면 메일 제목, 본문 일부, 첨부파일 이름만 AI로 보냅니다.
          </div>
        </div>
      </header>

      <section className="steps" aria-label="작업 순서">
        <div className={`step${projects.length ? " done" : ""}`}>
          <div className="step-head">
            <span className="step-no">1</span>
            <span className="step-title">과제 목록</span>
          </div>
          <Dropzone
            accept=".xlsx,.csv"
            label="과제 목록 엑셀 올리기"
            hint="과제번호, 과제명, 기관, 이메일 열이 있으면 됩니다"
            onFiles={loadProjects}
          />
          <div className="step-result">
            {projectInfo ? (
              <>
                {projects.length > 0 && (
                  <span>
                    {projectInfo.name}에서 과제 <b className="num">{projects.length}</b>개를 불러왔습니다.
                  </span>
                )}
                {projectInfo.warnings.map((w) => (
                  <span key={w} className="warn">
                    {w}
                  </span>
                ))}
              </>
            ) : (
              <button className="linkish" onClick={() => loadSamples("projects")}>
                가상 과제 목록으로 해보기
              </button>
            )}
          </div>
        </div>

        <div className={`step${mails.length ? " done" : ""}`}>
          <div className="step-head">
            <span className="step-no">2</span>
            <span className="step-title">받은 메일</span>
          </div>
          <Dropzone
            accept=".eml,.zip"
            multiple
            label="메일 파일 올리기"
            hint="두레이 필터로 모은 메일을 .eml(또는 묶은 .zip)로 저장해 올려 주세요"
            onFiles={loadMails}
          />
          <div className="step-result">
            {mailInfo ? (
              <>
                <span>
                  메일 <b className="num">{mails.length}</b>통을 읽었습니다.
                </span>
                {mailInfo.errors.map((w) => (
                  <span key={w} className="warn">
                    {w}
                  </span>
                ))}
                {mailInfo.skipped.length > 0 && (
                  <span className="warn">메일 파일이 아니어서 건너뛴 파일 {mailInfo.skipped.length}개</span>
                )}
              </>
            ) : (
              <button className="linkish" onClick={() => loadSamples("mails")}>
                가상 메일 43통으로 해보기
              </button>
            )}
          </div>
        </div>

        <div className={`step${mails.length && projects.length && remaining === 0 ? " done" : ""}`}>
          <div className="step-head">
            <span className="step-no">3</span>
            <span className="step-title">검토하고 내보내기</span>
          </div>
          <p className="step-desc">
            확인이 필요한 메일만 골라 과제를 정해 주세요. 나머지는 자동으로 분류됩니다. 끝나면 엑셀 현황표와 과제별 폴더(ZIP)로 내려받습니다.
          </p>
          {mails.length > 0 && projects.length > 0 ? (
            <div className="step-result">
              자동 분류 <b className="num">{counts.auto + counts.confirmed}</b>통, 확인 필요{" "}
              <b className="num" style={{ color: counts.review ? "var(--warn)" : undefined }}>
                {counts.review}
              </b>
              통, 미분류{" "}
              <b className="num" style={{ color: counts.unmatched ? "var(--bad)" : undefined }}>
                {counts.unmatched}
              </b>
              통
            </div>
          ) : (
            !projects.length &&
            !mails.length && (
              <button className="linkish" onClick={() => loadSamples("both")}>
                가상 데이터로 한 번에 체험하기
              </button>
            )
          )}
        </div>
      </section>

      <main className="work">
        {!mails.length || !projects.length ? (
          <div className="empty">
            <p>{!projects.length ? "먼저 과제 목록을 올려 주세요." : "이제 받은 메일 파일을 올려 주세요."}</p>
            <p style={{ fontSize: 13 }}>과제 목록과 메일이 모두 있어야 과제별로 분류할 수 있습니다.</p>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <div className="views" role="group" aria-label="보기 전환">
                <button aria-pressed={view === "ledger"} onClick={() => setView("ledger")}>
                  메일 접수대장
                </button>
                <button aria-pressed={view === "status"} onClick={() => setView("status")}>
                  과제별 제출현황
                </button>
              </div>
              <span className="spacer" />
              {ai?.enabled ? (
                <>
                  {ai.passwordRequired && (
                    <label className="pw">
                      접속 비밀번호
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          try {
                            sessionStorage.setItem("app-pw", e.target.value);
                          } catch {
                            /* 무시 */
                          }
                        }}
                      />
                    </label>
                  )}
                  <button className="btn" onClick={askAiAll} disabled={aiBusy.size > 0 || remaining === 0}>
                    {aiBusy.size > 0 ? `AI가 읽는 중 (${aiBusy.size})` : `확인 필요·미분류 ${remaining}통 AI에게 맡기기`}
                  </button>
                  <span className="ai-note">{ai.label}</span>
                </>
              ) : (
                <span className="ai-note">AI 판단 꺼짐: 규칙으로만 분류합니다</span>
              )}
            </div>

            {view === "ledger" ? (
              <>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  <div className="tabs" role="tablist" aria-label="처리 상태" style={{ flex: 1 }}>
                    {TAB_ORDER.map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={filter === t}
                        className={`tab ${t}`}
                        onClick={() => setFilter(t)}
                      >
                        {t === "all" ? "전체" : STATUS_LABEL[t]}
                        <span className="count">{counts[t]}</span>
                      </button>
                    ))}
                  </div>
                  <input
                    className="search"
                    type="search"
                    placeholder="제목, 보낸 사람, 과제, 파일명 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="메일 검색"
                  />
                </div>
                <div className={`split${sel?.mail && sel.result ? " with-detail" : ""}`}>
                  <Ledger rows={rows} projectsById={projectsById} selected={selected} onSelect={setSelected} />
                  {sel?.mail && sel.result && (
                    <Detail
                      mail={sel.mail}
                      result={sel.result}
                      projects={projects}
                      projectsById={projectsById}
                      docTypes={settings.requiredDocs}
                      aiEnabled={!!ai?.enabled}
                      aiBusy={aiBusy.has(sel.mail.id)}
                      onClose={() => setSelected(null)}
                      onAssign={(pid) => assign(sel.mail!.id, pid)}
                      onConfirm={() => update(sel.mail!.id, (r) => ({ ...r, status: "confirmed", edited: true }))}
                      onDocType={(i, type) =>
                        update(sel.mail!.id, (r) => ({
                          ...r,
                          edited: true,
                          attachments: r.attachments.map((a) => (a.index === i ? { ...a, docType: type, docReason: "담당자 지정" } : a)),
                        }))
                      }
                      onExclude={() =>
                        update(sel.mail!.id, (r) => ({
                          ...r,
                          relevant: false,
                          status: "excluded",
                          projectId: null,
                          relevanceReason: "담당자가 업무 메일 아님으로 표시",
                          edited: true,
                        }))
                      }
                      onInclude={() => {
                        const fresh = matchMail(sel.mail!, projects, settings);
                        update(sel.mail!.id, () => ({
                          ...fresh,
                          relevant: true,
                          status: fresh.status === "excluded" ? "unmatched" : fresh.status,
                          edited: true,
                        }));
                      }}
                      onAskAi={() => askAi(sel.mail!.id)}
                    />
                  )}
                </div>
              </>
            ) : (
              <StatusMatrix
                rows={status}
                docs={settings.requiredDocs}
                onOpenProject={(id) => {
                  setView("ledger");
                  setFilter("all");
                  setQuery(id);
                }}
              />
            )}

            <div className="export">
              <p>
                {remaining > 0 ? (
                  <span className="warn">
                    확인 필요 {counts.review}통, 미분류 {counts.unmatched}통이 남았습니다. 지금 내보내면 이 메일들은 &apos;01_확인필요&apos;,
                    &apos;00_미분류&apos; 폴더에 따로 담깁니다.
                  </span>
                ) : (
                  "모든 메일이 분류되었습니다. 엑셀 현황표와 과제별 폴더로 내려받으세요."
                )}
              </p>
              <button className="btn" onClick={exportExcel} disabled={!!busy}>
                엑셀 현황표 받기
              </button>
              <button className="btn primary" onClick={exportZip} disabled={!!busy}>
                과제별 폴더(ZIP) 받기
              </button>
            </div>
          </>
        )}
      </main>

      {(busy || toast) && (
        <div className="toast" role="status">
          {busy ? `${busy}…` : toast}
        </div>
      )}
    </>
  );
}

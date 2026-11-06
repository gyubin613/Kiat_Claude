"use client";
import { useEffect, useMemo, useState } from "react";
import { stripQuoted } from "@/lib/matcher";
import { kstDateTime } from "@/lib/text";
import type { MailResult, ParsedMail, Project } from "@/lib/types";
import { StatusMark } from "./Ledger";

function kb(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function Detail({
  mail,
  result,
  projects,
  projectsById,
  docTypes,
  aiEnabled,
  aiBusy,
  onClose,
  onAssign,
  onConfirm,
  onDocType,
  onExclude,
  onInclude,
  onAskAi,
}: {
  mail: ParsedMail;
  result: MailResult;
  projects: Project[];
  projectsById: Map<string, Project>;
  docTypes: string[];
  aiEnabled: boolean;
  aiBusy: boolean;
  onClose: () => void;
  onAssign: (projectId: string | null) => void;
  onConfirm: () => void;
  onDocType: (index: number, type: string) => void;
  onExclude: () => void;
  onInclude: () => void;
  onAskAi: () => void;
}) {
  const [pick, setPick] = useState("");
  useEffect(() => setPick(""), [mail.id]);

  const urls = useMemo(
    () =>
      mail.attachments.map((a) =>
        URL.createObjectURL(new Blob([a.content as BlobPart], { type: a.mimeType || "application/octet-stream" })),
      ),
    [mail],
  );
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const current = result.projectId ? projectsById.get(result.projectId) : undefined;
  const pickedId = (() => {
    const v = pick.trim();
    if (!v) return null;
    const exact = projects.find((p) => p.id === v || `${p.id} ${p.name}` === v);
    return exact?.id ?? null;
  })();
  const body = stripQuoted(mail.text) || "(본문 없음)";

  return (
    <aside className="detail" aria-label="메일 상세">
      <div className="detail-head">
        <h2>{mail.subject}</h2>
        <button className="close" onClick={onClose} aria-label="상세 닫기">
          ×
        </button>
      </div>

      <div className="detail-sec">
        <dl className="kv">
          <dt>상태</dt>
          <dd>
            <StatusMark r={result} />
          </dd>
          <dt>보낸 사람</dt>
          <dd>
            {mail.fromName} &lt;{mail.fromAddress}&gt;
          </dd>
          <dt>받은 날짜</dt>
          <dd className="num">{kstDateTime(mail.date)}</dd>
          <dt>원본 파일</dt>
          <dd>{mail.sourceName}</dd>
        </dl>
      </div>

      {result.status !== "excluded" ? (
        <div className="detail-sec">
          <h3>과제</h3>
          {current ? (
            <div style={{ fontSize: 13.5 }}>
              <b className="num">{current.id}</b> {current.name}
              <div className="sub" style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>
                {current.leadOrg} / {current.partnerOrg}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>아직 과제가 지정되지 않았습니다.</div>
          )}
          {result.reasons.length > 0 && (
            <ul className="reasons" style={{ marginTop: 8 }}>
              {result.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}

          {result.candidates.length > 0 && result.status !== "confirmed" && (
            <div className="cands">
              {result.candidates.slice(0, 4).map((c) => {
                const p = projectsById.get(c.projectId);
                if (!p) return null;
                return (
                  <button
                    key={c.projectId}
                    className={`cand${c.projectId === result.projectId ? " current" : ""}`}
                    onClick={() => onAssign(c.projectId)}
                    title="이 과제로 확정"
                  >
                    <span>
                      <b className="num">{p.id}</b> {p.name}
                      <small>{c.reasons.join(", ")}</small>
                    </span>
                    <span className="num" style={{ color: "var(--ink-faint)", fontSize: 12 }}>
                      {Math.min(100, c.score)}점
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="picker">
            <input
              list="project-options"
              placeholder="과제번호나 과제명으로 찾기"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              aria-label="다른 과제 지정"
            />
            <button className="btn small" disabled={!pickedId} onClick={() => pickedId && onAssign(pickedId)}>
              지정
            </button>
          </div>
          <datalist id="project-options">
            {projects.map((p) => (
              <option key={p.id} value={`${p.id} ${p.name}`} />
            ))}
          </datalist>

          <div className="actions" style={{ marginTop: 10 }}>
            {result.projectId && (result.status === "review" || result.status === "auto") && (
              <button className="btn small primary" onClick={onConfirm}>
                이 과제로 확정
              </button>
            )}
            {result.projectId && (
              <button className="btn small" onClick={() => onAssign(null)}>
                과제 지정 취소
              </button>
            )}
            {aiEnabled && (
              <button className="btn small" onClick={onAskAi} disabled={aiBusy}>
                {aiBusy ? "AI가 읽는 중…" : "AI에게 판단 맡기기"}
              </button>
            )}
            <button className="btn small" onClick={onExclude}>
              업무 메일 아님
            </button>
          </div>
        </div>
      ) : (
        <div className="detail-sec">
          <h3>업무 대상이 아닌 메일로 분류됨</h3>
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>{result.relevanceReason}</p>
          <button className="btn small" onClick={onInclude}>
            업무 메일로 되돌리기
          </button>
        </div>
      )}

      {mail.attachments.length > 0 && (
        <div className="detail-sec">
          <h3>첨부파일 {mail.attachments.length}개</h3>
          {mail.attachments.map((a, i) => (
            <div className="att-row" key={i}>
              <div>
                <a href={urls[i]} download={a.filename}>
                  {a.filename}
                </a>
                <small>
                  {kb(a.size)}, {result.attachments[i]?.docReason}
                </small>
              </div>
              <select
                value={result.attachments[i]?.docType ?? "기타"}
                onChange={(e) => onDocType(i, e.target.value)}
                aria-label={`${a.filename} 서류 종류`}
              >
                {[...docTypes, "기타"].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="detail-sec">
        <h3>본문</h3>
        {result.aiAssisted && result.summary && <p className="ai-summary">AI 요약: {result.summary}</p>}
        <pre className="body-text">{body}</pre>
      </div>
    </aside>
  );
}

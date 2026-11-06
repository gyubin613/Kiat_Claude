"use client";
import { useState } from "react";
import type { ProjectStatusRow } from "@/lib/organize";
import { kstDateTime } from "@/lib/text";

const STATE_CLASS = { 완료: "done", "일부 제출": "part", 미제출: "none" } as const;

export function StatusMatrix({
  rows,
  docs,
  onOpenProject,
}: {
  rows: ProjectStatusRow[];
  docs: string[];
  onOpenProject: (id: string) => void;
}) {
  const [onlyMissing, setOnlyMissing] = useState(false);
  const shown = onlyMissing ? rows.filter((r) => r.missing.length) : rows;
  const done = rows.filter((r) => r.state === "완료").length;
  return (
    <>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
          과제 {rows.length}개 중 <b style={{ color: "var(--ink)" }}>{done}개</b> 서류를 모두 받았습니다.
        </span>
        <span className="spacer" />
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          미제출 서류가 있는 과제만
        </label>
      </div>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>과제번호</th>
              <th>과제명</th>
              <th>해외기관</th>
              <th>담당자</th>
              {docs.map((d) => (
                <th key={d} className="doc">
                  {d}
                </th>
              ))}
              <th>상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.project.id}>
                <td className="num" style={{ fontWeight: 500 }}>
                  {r.project.id}
                </td>
                <td className="pname">
                  {r.project.name}
                  <small>{r.project.leadOrg}</small>
                </td>
                <td>
                  {r.project.partnerOrg}
                  <small style={{ display: "block", color: "var(--ink-faint)", fontSize: 12 }}>{r.project.country}</small>
                </td>
                <td>{r.project.manager}</td>
                {docs.map((d) => {
                  const v = r.docs[d];
                  return (
                    <td key={d} className="doc">
                      {v ? (
                        <span className="stamp" title={`${d} ${v.count}건, 마지막 ${kstDateTime(v.receivedAt)}`}>
                          <span>
                            접수
                            <b>{kstDateTime(v.receivedAt).slice(5, 10).replace("-", ".")}</b>
                          </span>
                        </span>
                      ) : (
                        <span className="stamp-empty">미제출</span>
                      )}
                    </td>
                  );
                })}
                <td>
                  <span className={`state ${STATE_CLASS[r.state]}`}>{r.state}</span>
                </td>
                <td>
                  <button className="btn small" onClick={() => onOpenProject(r.project.id)}>
                    메일 보기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

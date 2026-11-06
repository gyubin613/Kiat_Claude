"use client";
import { STATUS_LABEL } from "@/lib/organize";
import { kstDateTime } from "@/lib/text";
import type { MailResult, ParsedMail, Project } from "@/lib/types";

export function StatusMark({ r }: { r: MailResult }) {
  return (
    <span className={`status ${r.status}`}>
      {STATUS_LABEL[r.status]}
      {r.aiAssisted && <span className="ai-tag">AI</span>}
    </span>
  );
}

export function Ledger({
  rows,
  projectsById,
  selected,
  onSelect,
}: {
  rows: { mail: ParsedMail; result: MailResult }[];
  projectsById: Map<string, Project>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (!rows.length) {
    return (
      <div className="ledger-wrap">
        <div className="empty" style={{ border: "none" }}>
          <p>이 조건에 맞는 메일이 없습니다.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th style={{ width: 110 }}>상태</th>
            <th style={{ width: 120 }}>받은 날짜</th>
            <th>보낸 사람</th>
            <th>제목과 첨부</th>
            <th>과제</th>
            <th style={{ width: 90 }}>신뢰도</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ mail, result }) => {
            const p = result.projectId ? projectsById.get(result.projectId) : undefined;
            return (
              <tr
                key={mail.id}
                aria-selected={selected === mail.id}
                onClick={() => onSelect(mail.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(mail.id);
                }}
              >
                <td>
                  <StatusMark r={result} />
                </td>
                <td className="num">{kstDateTime(mail.date)}</td>
                <td>
                  <div className="from">{mail.fromName || mail.fromAddress}</div>
                  <div className="sub from">{mail.fromAddress}</div>
                </td>
                <td>
                  <span className="subject" title={mail.subject}>
                    {mail.subject}
                  </span>
                  {mail.attachments.length > 0 && (
                    <div className="chips">
                      {result.attachments.map((a) => (
                        <span key={a.index} className={`chip ${a.docType === "기타" ? "etc" : "doc"}`} title={a.filename}>
                          {a.docType}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {p ? (
                    <>
                      <span className="proj-id">{p.id}</span>
                      <span className="proj-name" title={p.name}>
                        {p.name}
                      </span>
                    </>
                  ) : (
                    <span className="sub">{result.status === "excluded" ? "" : "지정 안 됨"}</span>
                  )}
                </td>
                <td>
                  {result.status !== "excluded" && result.status !== "confirmed" && (
                    <div className="conf">
                      <div className="conf-bar" aria-hidden>
                        <span style={{ width: `${result.confidence}%` }} />
                      </div>
                      {result.confidence}
                    </div>
                  )}
                  {result.status === "confirmed" && <span className="sub">담당자 확인</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

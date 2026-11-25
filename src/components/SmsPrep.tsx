"use client";

import { useMemo, useState } from "react";
import { Modal, useToast } from "./ui";
import { audienceOfClient } from "@/lib/summary";
import { AUDIENCE_LABEL, type AnnouncementAudience, type Evaluation, type Evaluator, type Invite } from "@/lib/types";
import {
  matchPhones, pasteText, phoneEntriesFromRows, SMS_HEADERS, SMS_MAX_BYTES, SMS_SHORT_BYTES, smsBytes, smsTemplate, type PhoneEntry,
} from "@/lib/sms";

/** 엑셀 셀 값을 글자로 (브라우저 전용) */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; richText?: { text: string }[]; result?: unknown };
    if (typeof o.text === "string") return o.text.trim();
    if (o.richText) return o.richText.map((r) => r.text).join("").trim();
    if ("result" in o) return cellText(o.result);
  }
  return String(v).trim();
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 기관 문자 발송 준비: 대상 위원의 휴대폰 번호를 K-PASS 파일에서 찾아
 * 문자 발송 화면에 붙여넣을 목록·엑셀과 문구를 만든다.
 * 휴대폰 번호는 이 브라우저 안에서만 쓰고 서버로 보내지 않는다.
 */
export default function SmsPrep({
  evaluation,
  invites,
  evaluators,
  onClose,
}: {
  evaluation: Evaluation;
  invites: Invite[];
  evaluators: Evaluator[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [audience, setAudience] = useState<AnnouncementAudience>("waiting");
  const [text, setText] = useState(() => smsTemplate(evaluation, "waiting"));
  const [entries, setEntries] = useState<PhoneEntry[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileErr, setFileErr] = useState("");
  const [reading, setReading] = useState(false);
  const byId = useMemo(() => new Map(evaluators.map((v) => [v.id, v])), [evaluators]);

  const recipients = useMemo(
    () =>
      audienceOfClient(invites, audience)
        .filter((i) => i.status === "sent" || audience !== "waiting")
        .map((i) => byId.get(i.evaluatorId))
        .filter((v): v is Evaluator => !!v)
        .map((v) => ({ id: v.id, name: v.name, org: v.org, phone: v.phone })),
    [invites, audience, byId],
  );
  const matched = useMemo(() => matchPhones(recipients, entries), [recipients, entries]);
  const ready = matched.filter((m) => m.phone);
  const missing = matched.filter((m) => !m.phone);
  const bytes = smsBytes(text);

  async function readFile(f: File) {
    setFileErr("");
    setFileName(f.name);
    setReading(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      const rows: string[][] = [];
      for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const out: string[] = [];
        for (let c = 1; c <= ws.columnCount; c++) out.push(cellText(row.getCell(c).value));
        rows.push(out);
      }
      const list = phoneEntriesFromRows(rows);
      if (!list.length) setFileErr("이 파일에서 성명·연락처(핸드폰) 열을 찾지 못했습니다. K-PASS 위원 검색 양식이나 정보화실 목록을 올려 주세요.");
      setEntries(list);
    } catch {
      setEntries([]);
      setFileErr("엑셀(.xlsx) 파일을 읽지 못했습니다.");
    } finally {
      setReading(false);
    }
  }

  async function downloadXlsx() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("수신자");
    ws.addRow([...SMS_HEADERS]);
    ws.getRow(1).font = { bold: true };
    ws.columns = [{ width: 30 }, { width: 14 }, { width: 24 }];
    ready.forEach((m) => ws.addRow([m.phone, m.name, m.org]));
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `문자수신자_${evaluation.name.slice(0, 20)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Modal size="lg" title="문자 알림 준비 (기관 문자 발송용)" onClose={onClose} footer={<button className="btn" onClick={onClose}>닫기</button>}>
      <div className="stack">
        <div className="notice">
          기관 문자 발송 화면에 그대로 붙여넣거나 올릴 수 있는 <b>수신자 목록</b>과 <b>문구</b>를 만듭니다.
          휴대폰 번호는 이 PC의 브라우저 안에서만 쓰이고 <b>시스템에 저장되지 않습니다.</b>
        </div>

        <div className="row">
          <span className="strong small">보낼 대상</span>
          <div className="seg" role="radiogroup" aria-label="문자 대상">
            {(["waiting", "attending", "all"] as AnnouncementAudience[]).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={audience === a}
                className={audience === a ? "on" : ""}
                onClick={() => {
                  setAudience(a);
                  setText(smsTemplate(evaluation, a));
                }}
              >
                {a === "waiting" ? "회신 대기 위원 (메일 보낸 뒤 무응답)" : AUDIENCE_LABEL[a]}
              </button>
            ))}
          </div>
          <span className="small muted">{recipients.length}명</span>
        </div>

        <div className="field">
          <label htmlFor="sms-text">문자 문구 (모든 수신자에게 같은 내용)</label>
          <textarea id="sms-text" className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <span className="hint" style={{ color: bytes > SMS_MAX_BYTES ? "var(--bad)" : undefined }}>
            {bytes} / {SMS_MAX_BYTES} byte · {bytes > SMS_SHORT_BYTES ? "장문(LMS)" : "단문(SMS)"} — 위원별 회신 링크는 넣을 수 없어 메일 확인을 안내합니다.
          </span>
          <button
            type="button"
            className="btn sm"
            style={{ justifySelf: "start" }}
            onClick={async () => toast((await copy(text)) ? "문구를 복사했습니다. 문자 발송 화면의 내용 칸에 붙여넣으세요." : "복사하지 못했습니다. 직접 선택해 복사해 주세요.", "ok")}
          >
            문구 복사
          </button>
        </div>

        <div className="field">
          <label htmlFor="sms-file">휴대폰 번호 찾기 — K-PASS에서 내려받은 위원 파일 선택</label>
          <input id="sms-file" type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} aria-label="K-PASS 위원 파일 선택" />
          <span className="hint">
            {reading ? "파일을 읽는 중…" : fileName ? `${fileName}: 휴대폰 번호 ${entries.length}건을 읽었습니다.` : "위원 검색 양식(연락처 열)이나 정보화실 목록(핸드폰 열)을 고르면 성명·소속으로 맞춰 번호를 찾습니다."}
          </span>
          {fileErr && <span className="err">{fileErr}</span>}
        </div>

        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="table">
            <thead><tr><th>이름</th><th>소속</th><th>휴대폰 번호</th><th>찾은 곳</th></tr></thead>
            <tbody>
              {matched.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="small">{m.org}</td>
                  <td className="mono small">{m.phone || <span className="faint">-</span>}</td>
                  <td>{m.found === "stored" ? <span className="badge">위원 정보</span> : m.found === "file" ? <span className="badge ok">K-PASS 파일</span> : <span className="badge warn">못 찾음</span>}</td>
                </tr>
              ))}
              {!matched.length && (
                <tr><td colSpan={4} className="muted">보낼 대상이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {missing.length > 0 && (
          <div className="notice warn small">번호를 찾지 못한 위원 {missing.length}명({missing.map((m) => m.name).join(", ")})은 K-PASS에서 확인해 직접 추가해 주세요.</div>
        )}

        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!ready.length}
            onClick={async () => toast((await copy(pasteText(ready))) ? `${ready.length}명 목록을 복사했습니다. 문자 발송 화면의 수신자 목록 칸에 붙여넣으세요 (Ctrl+V).` : "복사하지 못했습니다. 엑셀로 내려받아 올려 주세요.", "ok")}
          >
            수신자 목록 복사 ({ready.length}명)
          </button>
          <button type="button" className="btn" disabled={!ready.length} onClick={downloadXlsx}>
            문자 발송용 엑셀 내려받기
          </button>
        </div>
        <ol className="small muted" style={{ margin: 0, paddingLeft: 20 }}>
          <li>기관 문자 발송 화면을 엽니다.</li>
          <li>[문구 복사] 후 내용 칸에 붙여넣습니다.</li>
          <li>[수신자 목록 복사] 후 수신자 목록 칸에 붙여넣거나(Ctrl+V), 내려받은 엑셀을 [엑셀 업로드]로 올립니다.</li>
          <li>수신자와 문구를 확인하고 발송합니다.</li>
        </ol>
      </div>
    </Modal>
  );
}

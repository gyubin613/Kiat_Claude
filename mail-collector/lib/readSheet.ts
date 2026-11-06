import ExcelJS from "exceljs";

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if (typeof o.text === "string") {
      // 하이퍼링크 셀(메일 주소 등)
      const link = typeof o.hyperlink === "string" ? o.hyperlink.replace(/^mailto:/i, "") : "";
      return link && !String(o.text).includes("@") && link.includes("@") ? `${o.text} ${link}` : String(o.text);
    }
    if ("result" in o) return o.result === undefined || o.result === null ? "" : String(o.result);
    if (typeof o.error === "string") return "";
  }
  return String(v);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** 과제 목록 파일(xlsx/csv) → 문자열 2차원 배열 (첫 번째 시트) */
export async function readSheet(bytes: Uint8Array, filename: string): Promise<string[][]> {
  if (filename.toLowerCase().endsWith(".csv")) {
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.includes("�")) {
      try {
        text = new TextDecoder("euc-kr").decode(bytes);
      } catch {
        /* 그대로 사용 */
      }
    }
    return parseCsv(text.replace(/^﻿/, ""));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const out: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) out.push(cellText(row.getCell(c).value).trim());
    rows.push(out);
  });
  return rows;
}

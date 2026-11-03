import ExcelJS from "exceljs";
import type { Evaluation, Evaluator, Invite } from "./types";
import { ATTENDANCE_LABEL, DISPLAY_STATE_LABEL, inviteDisplayState } from "./types";
import { evaluatorInput } from "./validate";
import { formatDateTime, formatSlot } from "./util";
import { slotSummary } from "./summary";
import type { z } from "zod";

type Field = keyof z.input<typeof evaluatorInput>;

const COLUMNS: { field: Field; header: string; aliases: string[]; width: number }[] = [
  { field: "name", header: "성명", aliases: ["성명", "이름", "위원명", "name"], width: 12 },
  { field: "org", header: "소속기관", aliases: ["소속기관", "소속", "기관", "기관명", "organization"], width: 22 },
  { field: "email", header: "이메일", aliases: ["이메일", "email", "e-mail", "메일"], width: 28 },
  { field: "phone", header: "연락처", aliases: ["연락처", "전화번호", "휴대폰", "전화", "phone"], width: 16 },
  { field: "expertise", header: "전문분야", aliases: ["전문분야", "분야", "전공"], width: 24 },
  { field: "pastInvited", header: "과거 초청 횟수", aliases: ["과거초청횟수", "초청횟수", "초청"], width: 14 },
  { field: "pastAttended", header: "과거 참여 횟수", aliases: ["과거참여횟수", "참여횟수", "참여", "참석횟수"], width: 14 },
  { field: "preference", header: "관리자 선호도(1~5)", aliases: ["관리자선호도(1~5)", "관리자선호도", "선호도"], width: 16 },
  { field: "note", header: "비고", aliases: ["비고", "메모", "note"], width: 24 },
];

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text.trim(); // 하이퍼링크
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v).trim();
}

export type ParsedRow = {
  row: number;
  ok: boolean;
  data?: z.output<typeof evaluatorInput>;
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
};

export async function parseEvaluatorWorkbook(buf: ArrayBuffer): Promise<{ rows: ParsedRow[]; unmatchedHeaders: string[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new Error("엑셀(.xlsx) 파일을 읽을 수 없습니다. 파일 형식을 확인해 주세요.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("시트가 없는 파일입니다.");

  // 머리글 행 탐색 (상위 5행 중 인식되는 열이 가장 많은 행)
  let headerRow = 0;
  let colMap = new Map<number, Field>();
  let unmatched: string[] = [];
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const map = new Map<number, Field>();
    const miss: string[] = [];
    ws.getRow(r).eachCell((cell, col) => {
      const t = norm(cellText(cell.value));
      if (!t) return;
      const c = COLUMNS.find((c) => c.aliases.some((a) => norm(a) === t));
      if (c && ![...map.values()].includes(c.field)) map.set(col, c.field);
      else miss.push(cellText(cell.value));
    });
    if (map.size > colMap.size) {
      colMap = map;
      headerRow = r;
      unmatched = miss;
    }
  }
  if (!headerRow || ![...colMap.values()].includes("name"))
    throw new Error("머리글에서 '성명' 열을 찾지 못했습니다. 등록 양식을 내려받아 사용해 주세요.");

  const rows: ParsedRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: Record<string, string> = {};
    colMap.forEach((field, col) => (raw[field] = cellText(row.getCell(col).value)));
    if (Object.values(raw).every((v) => !v)) continue; // 빈 행
    const parsed = evaluatorInput.safeParse({
      name: raw.name ?? "",
      org: raw.org ?? "",
      email: raw.email ?? "",
      phone: raw.phone ?? "",
      expertise: raw.expertise ?? "",
      pastInvited: raw.pastInvited ?? null,
      pastAttended: raw.pastAttended ?? null,
      preference: raw.preference ?? null,
      note: raw.note ?? "",
    });
    const warnings: string[] = [];
    if (!raw.email) warnings.push("이메일 누락");
    if (!raw.org) warnings.push("소속기관 누락");
    if (parsed.success) rows.push({ row: r, ok: true, data: parsed.data, raw, errors: [], warnings });
    else
      rows.push({
        row: r,
        ok: false,
        raw,
        errors: parsed.error.issues.map((i) => `${COLUMNS.find((c) => c.field === i.path[0])?.header ?? ""} ${i.message}`.trim()),
        warnings,
      });
  }
  return { rows, unmatchedHeaders: unmatched };
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  r.alignment = { vertical: "middle", horizontal: "center" };
  r.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export async function buildTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("평가위원 명단");
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
  styleHeader(ws);
  ws.addRow({ name: "홍길동", org: "가상대학교", email: "hong@example.com", phone: "010-0000-0000", expertise: "기계설계", pastInvited: 3, pastAttended: 2, preference: 4, note: "예시 행입니다. 삭제 후 사용하세요." });
  ws.addRow({ name: "김예시", org: "가상연구원", email: "", phone: "", expertise: "인공지능", note: "일부 항목이 비어 있어도 등록 후 보완할 수 있습니다." });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildRosterWorkbook(list: Evaluator[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("평가위원 명단");
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
  styleHeader(ws);
  list.forEach((v) => ws.addRow(v));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildResponsesWorkbook(e: Evaluation, invites: Invite[], evaluators: Map<string, Evaluator>) {
  const wb = new ExcelJS.Workbook();
  const slotLabel = new Map(e.slots.map((s, i) => [s.id, `${i + 1}) ${formatSlot(s, false)}`]));

  const ws = wb.addWorksheet("회신 현황");
  ws.columns = [
    { header: "차수", key: "round", width: 6 },
    { header: "성명", key: "name", width: 12 },
    { header: "소속기관", key: "org", width: 22 },
    { header: "이메일", key: "email", width: 28 },
    { header: "연락처", key: "phone", width: 16 },
    { header: "상태", key: "state", width: 12 },
    { header: "참석 가능 일정", key: "slots", width: 44 },
    { header: "참고사항", key: "note", width: 36 },
    { header: "발송일시", key: "sentAt", width: 17 },
    { header: "회신일시", key: "respondedAt", width: 17 },
  ];
  styleHeader(ws);
  for (const inv of invites) {
    const v = evaluators.get(inv.evaluatorId);
    ws.addRow({
      round: `${inv.round}차`,
      name: v?.name ?? "(삭제됨)",
      org: v?.org ?? "",
      email: v?.email ?? "",
      phone: v?.phone ?? "",
      state: DISPLAY_STATE_LABEL[inviteDisplayState(inv)],
      slots: inv.response?.slotIds.map((id) => slotLabel.get(id) ?? "").filter(Boolean).join("\n") ?? "",
      note: [inv.response?.note, inv.withdrawnReason && `철회 사유: ${inv.withdrawnReason}`].filter(Boolean).join("\n"),
      sentAt: formatDateTime(inv.sentAt),
      respondedAt: formatDateTime(inv.response?.updatedAt),
    }).alignment = { wrapText: true, vertical: "top" };
  }

  const ws2 = wb.addWorksheet("일정별 집계");
  ws2.columns = [
    { header: "후보 일정", key: "slot", width: 40 },
    { header: "장소", key: "place", width: 22 },
    { header: "참석 가능", key: "yes", width: 10 },
    { header: "조건부", key: "cond", width: 10 },
    { header: "합계", key: "total", width: 8 },
    { header: `배석 인원(${e.seats}명) 충족`, key: "meets", width: 16 },
    { header: "참석 가능 위원", key: "names", width: 50 },
  ];
  styleHeader(ws2);
  for (const s of slotSummary(e, invites)) {
    const names = [
      ...s.yes.map((id) => evaluators.get(id)?.name ?? ""),
      ...s.conditional.map((id) => `${evaluators.get(id)?.name ?? ""}(조건부)`),
    ].join(", ");
    ws2.addRow({
      slot: formatSlot(s.slot, false),
      place: s.slot.place,
      yes: s.yes.length,
      cond: s.conditional.length,
      total: s.total,
      meets: s.meetsSeats ? "충족" : s.meetsSeatsWithConditional ? "조건부 포함 시 충족" : "부족",
      names,
    });
  }

  if (e.finalization) {
    const f = e.finalization;
    const ws3 = wb.addWorksheet("최종 확정");
    ws3.columns = [
      { header: "구분", key: "k", width: 16 },
      { header: "내용", key: "v", width: 60 },
    ];
    styleHeader(ws3);
    ws3.addRow({ k: "평가명", v: e.name });
    ws3.addRow({ k: "확정 일정", v: formatSlot(f.slot) });
    ws3.addRow({ k: "확정 일시", v: formatDateTime(f.finalizedAt) });
    ws3.addRow({ k: "메모", v: f.memo });
    ws3.addRow({});
    ws3.addRow({ k: "참석 위원", v: "" }).font = { bold: true };
    f.members.forEach((m, i) =>
      ws3.addRow({ k: `${i + 1}`, v: `${m.name} (${m.org || "소속 미입력"}) - ${ATTENDANCE_LABEL[m.attendance]}` }),
    );
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

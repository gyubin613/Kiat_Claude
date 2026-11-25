import ExcelJS from "exceljs";
import type { Evaluation, Evaluator, Invite } from "./types";
import { ATTENDANCE_LABEL, DISPLAY_STATE_LABEL, inviteDisplayState } from "./types";
import { evaluatorInput } from "./validate";
import { formatDateTime, formatSlot } from "./util";
import { slotSummary } from "./summary";
import { bachelorText, finalText } from "./profile";
import { detectFormat, FORMAT_LABEL, groupItRows, looseDate, norm, PRIVATE_HEADERS, type ImportFormat, type ItRow } from "./kpass";
import type { z } from "zod";

type Field = keyof z.input<typeof evaluatorInput>;

const COLUMNS: { field: Field; header: string; aliases: string[]; width: number }[] = [
  { field: "name", header: "성명", aliases: ["성명", "이름", "위원명", "평가위원명", "name"], width: 12 },
  { field: "org", header: "소속기관", aliases: ["소속기관", "소속", "기관", "기관명", "organization"], width: 22 },
  { field: "email", header: "이메일", aliases: ["이메일", "email", "e-mail", "메일"], width: 28 },
  { field: "phone", header: "연락처", aliases: ["연락처", "전화번호", "휴대폰", "전화", "phone"], width: 16 },
  { field: "expertise", header: "전문분야", aliases: ["전문분야", "분야", "전공"], width: 24 },
  { field: "techFields", header: "기술분야", aliases: ["기술분야", "기술분류"], width: 24 },
  { field: "kpassEvalCount", header: "K-PASS 평가횟수", aliases: ["k-pass평가횟수", "kpass평가횟수", "평가횟수", "평가이력"], width: 14 },
  { field: "intlPool", header: "국제기술협력단 위원(Y/N)", aliases: ["국제기술협력단위원(y/n)", "국제기술협력단평가위원여부", "국제기술협력단위원", "국제기술협력단"], width: 16 },
  { field: "pastInvited", header: "과거 초청 횟수", aliases: ["과거초청횟수", "초청횟수", "초청"], width: 14 },
  { field: "pastAttended", header: "과거 참여 횟수", aliases: ["과거참여횟수", "참여횟수", "참여", "참석횟수"], width: 14 },
  { field: "preference", header: "관리자 선호도(1~5)", aliases: ["관리자선호도(1~5)", "관리자선호도", "선호도"], width: 16 },
  { field: "note", header: "비고", aliases: ["비고", "메모", "note"], width: 24 },
  { field: "bachelorSchool", header: "학사 학교", aliases: ["학사학교", "학사대학", "학부", "출신대학", "학사"], width: 18 },
  { field: "bachelorMajor", header: "학사 전공", aliases: ["학사전공", "학부전공"], width: 16 },
  { field: "bachelorAbroad", header: "학사 해외(Y/N)", aliases: ["학사해외(y/n)", "학사해외", "학사해외여부"], width: 12 },
  { field: "finalDegree", header: "최종학위", aliases: ["최종학위", "최종학력", "학위"], width: 10 },
  { field: "finalSchool", header: "최종학력 학교", aliases: ["최종학력학교", "최종학교", "최종대학"], width: 18 },
  { field: "finalMajor", header: "최종학력 전공", aliases: ["최종학력전공", "최종전공"], width: 16 },
  { field: "finalAbroad", header: "최종학력 해외(Y/N)", aliases: ["최종학력해외(y/n)", "최종학력해외", "최종해외", "최종학력해외여부"], width: 14 },
  { field: "overseasWorkYears", header: "해외 근무 경력(년)", aliases: ["해외근무경력(년)", "해외근무경력", "해외근무", "해외경력"], width: 14 },
  { field: "overseasWorkDetail", header: "해외 근무 내용", aliases: ["해외근무내용", "해외근무기관"], width: 24 },
  { field: "sanction", header: "제재(기간·사유)", aliases: ["제재(기간·사유)", "제재", "제재정보"], width: 24 },
];

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

export type ParsedWorkbook = {
  rows: ParsedRow[];
  unmatchedHeaders: string[];
  format: ImportFormat;
  /** 파일 전체에 대한 안내 (읽지 않은 개인정보 열, 추정한 항목 등) */
  notices: string[];
};

function rowTexts(ws: ExcelJS.Worksheet, r: number) {
  const out: string[] = [];
  const row = ws.getRow(r);
  for (let c = 1; c <= ws.columnCount; c++) out[c] = cellText(row.getCell(c).value); // 병합 셀은 첫 칸 값으로 읽힘
  return out;
}

const findColumn = (h: string) => {
  const t = norm(h);
  if (t.startsWith("기술분야") || t.startsWith("기술분류")) return COLUMNS.find((c) => c.field === "techFields")!;
  return COLUMNS.find((c) => c.aliases.some((a) => norm(a) === t));
};

function toRow(r: number, raw: Record<string, string>, extraWarnings: string[] = []): ParsedRow {
  const get = (k: Field) => raw[k] ?? "";
  const nul = (k: Field) => (raw[k] ? raw[k] : null);
  const parsed = evaluatorInput.safeParse({
    name: get("name"), org: get("org"), email: get("email"), phone: get("phone"), expertise: get("expertise"),
    pastInvited: nul("pastInvited"), pastAttended: nul("pastAttended"), preference: nul("preference"), note: get("note"),
    bachelorSchool: get("bachelorSchool"), bachelorMajor: get("bachelorMajor"), bachelorAbroad: nul("bachelorAbroad"),
    finalDegree: get("finalDegree"), finalSchool: get("finalSchool"), finalMajor: get("finalMajor"), finalAbroad: nul("finalAbroad"),
    overseasWorkYears: nul("overseasWorkYears"), overseasWorkDetail: get("overseasWorkDetail"),
    techFields: get("techFields"), kpassEvalCount: nul("kpassEvalCount"), intlPool: nul("intlPool"), sanction: get("sanction"),
  });
  const warnings: string[] = [];
  if (!raw.email) warnings.push("이메일 누락");
  if (!raw.org) warnings.push("소속기관 누락");
  if (raw.sanction) warnings.push(`제재 기간 중(${raw.sanction}) — 초청 전 확인 필요`);
  warnings.push(...extraWarnings);
  if (parsed.success) return { row: r, ok: true, data: parsed.data, raw, errors: [], warnings };
  return {
    row: r,
    ok: false,
    raw,
    errors: parsed.error.issues.map((i) => `${COLUMNS.find((c) => c.field === i.path[0])?.header ?? ""} ${i.message}`.trim()),
    warnings,
  };
}

export async function parseEvaluatorWorkbook(buf: ArrayBuffer): Promise<ParsedWorkbook> {
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
  let best = 0;
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const texts = rowTexts(ws, r);
    const n = texts.filter((t) => t && (findColumn(t) || norm(t) === "ecmm_id")).length;
    if (n > best) {
      best = n;
      headerRow = r;
    }
  }
  if (!headerRow) throw new Error("머리글에서 '성명' 열을 찾지 못했습니다. 등록 양식을 내려받아 사용해 주세요.");
  const headers = rowTexts(ws, headerRow);
  const format = detectFormat(headers.filter(Boolean));
  if (format === "kpass-it") return parseItList(ws, headerRow, headers);

  // 두 줄 머리글: 다음 행에 '1순위' 같은 하위 머리글이 있으면 합쳐서 읽는다 (예: 기술분야 + 1순위)
  let dataStart = headerRow + 1;
  const sub = rowTexts(ws, headerRow + 1);
  if (sub.some((t) => /^\d+순위$/.test(norm(t ?? "")))) {
    sub.forEach((t, c) => {
      if (t && t !== headers[c]) headers[c] = `${headers[c] ?? ""}${t}`;
    });
    dataStart = headerRow + 2;
  }

  const colMap = new Map<number, Field>();
  const unmatched: string[] = [];
  const skippedPrivate: string[] = [];
  headers.forEach((h, col) => {
    if (!h) return;
    const isPrivate = PRIVATE_HEADERS.some((p) => norm(p) === norm(h));
    if (format !== "standard" && isPrivate) return void skippedPrivate.push(h);
    if (norm(h) === "생년월일") return void skippedPrivate.push(h);
    const c = findColumn(h);
    if (c && (c.field === "techFields" || ![...colMap.values()].includes(c.field))) colMap.set(col, c.field);
    else unmatched.push(h);
  });
  if (![...colMap.values()].includes("name"))
    throw new Error("머리글에서 '성명' 열을 찾지 못했습니다. 등록 양식을 내려받아 사용해 주세요.");

  const rows: ParsedRow[] = [];
  for (let r = dataStart; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: Record<string, string> = {};
    const tech: string[] = [];
    colMap.forEach((field, col) => {
      const t = cellText(row.getCell(col).value);
      if (field === "techFields") {
        if (t && !tech.includes(t)) tech.push(t);
      } else raw[field] = t;
    });
    if (tech.length) raw.techFields = tech.join(" / ");
    if (Object.values(raw).every((v) => !v)) continue; // 빈 행
    rows.push(toRow(r, raw));
  }

  const notices: string[] = [];
  if (format !== "standard") notices.push(`${FORMAT_LABEL[format]}으로 인식했습니다.`);
  if (skippedPrivate.length)
    notices.push(`개인정보 최소 수집을 위해 ${[...new Set(skippedPrivate)].join(", ")} 열은 읽지 않았습니다. 초청은 이메일로만 진행합니다.`);
  return { rows, unmatchedHeaders: unmatched, format, notices };
}

/** 정보화실 목록: 한 위원이 학력·경력 수만큼 여러 줄 → 위원별로 묶는다 */
function parseItList(ws: ExcelJS.Worksheet, headerRow: number, headers: string[]): ParsedWorkbook {
  const col = (...names: string[]) => {
    const i = headers.findIndex((h) => h && names.some((n) => norm(n) === norm(h)));
    return i > 0 ? i : 0;
  };
  const c = {
    id: col("ECMM_ID"), name: col("성명"), org: col("소속"), school: col("학교"), major: col("전공"), degree: col("학위"),
    workplace: col("근무처"), workStart: col("근무시작일자"), workEnd: col("근무종료일자"),
    sStart: col("제재시작일"), sEnd: col("제재종료일"), sReason: col("제재사유"),
  };
  const techCols = headers.map((h, i) => (h && /^기술분야\d*$/.test(norm(h)) ? i : 0)).filter(Boolean);
  if (!c.name) throw new Error("머리글에서 '성명' 열을 찾지 못했습니다.");

  const items: ItRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const t = (i: number) => (i ? cellText(row.getCell(i).value) : "");
    const d = (i: number) => (i ? looseDate(row.getCell(i).value instanceof Date ? (row.getCell(i).value as Date) : t(i)) : null);
    const item: ItRow = {
      row: r, id: t(c.id), name: t(c.name), org: t(c.org), tech: techCols.map(t),
      sanctionStart: d(c.sStart), sanctionEnd: d(c.sEnd), sanctionReason: t(c.sReason),
      school: t(c.school), major: t(c.major), degree: t(c.degree),
      workplace: t(c.workplace), workStart: d(c.workStart), workEnd: d(c.workEnd),
    };
    if (!item.id && !item.name) continue;
    items.push(item);
  }

  const today = new Date().toISOString().slice(0, 10);
  const people = groupItRows(items, today);
  const yn = (b: boolean | null) => (b == null ? "" : b ? "Y" : "N");
  const rows = people.map((p) =>
    toRow(
      p.row,
      {
        name: p.name, org: p.org, email: "", techFields: p.techFields,
        bachelorSchool: p.bachelorSchool, bachelorMajor: p.bachelorMajor, bachelorAbroad: yn(p.bachelorAbroad),
        finalDegree: p.finalDegree, finalSchool: p.finalSchool, finalMajor: p.finalMajor, finalAbroad: yn(p.finalAbroad),
        overseasWorkYears: p.overseasWorkYears == null ? "" : String(p.overseasWorkYears), overseasWorkDetail: p.overseasWorkDetail,
        sanction: p.sanction,
      },
    ),
  );
  const known = new Set(["ecmm_id", "성명", "소속", "학교", "전공", "학위", "근무처", "근무시작일자", "근무종료일자", "제재시작일", "제재종료일", "제재사유", "순번", "직위", "핸드폰"].map(norm));
  const unmatched = headers.filter((h) => h && !known.has(norm(h)) && !/^기술분야\d*$/.test(norm(h)));
  const notices = [
    `${FORMAT_LABEL["kpass-it"]}으로 인식했습니다. 여러 줄로 된 학력·경력을 위원 ${people.length}명으로 묶었습니다.`,
    "이 목록에는 이메일이 없습니다. K-PASS 위원 검색 양식을 먼저 올리고, 이 파일은 '빈 항목만 보완'으로 올리면 학력·해외경력·제재 정보가 더해집니다.",
    "해외 대학·근무 여부는 학교·근무처 이름으로 추정했습니다. 위원 정보에서 확인해 주세요.",
  ];
  if (headers.some((h) => h && norm(h) === "핸드폰")) notices.push("개인정보 최소 수집을 위해 핸드폰 열은 읽지 않았습니다.");
  return { rows, unmatchedHeaders: unmatched, format: "kpass-it", notices };
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
  ws.addRow({ name: "홍길동", org: "가상대학교", email: "hong@example.com", phone: "010-0000-0000", expertise: "기계설계", pastInvited: 3, pastAttended: 2, preference: 4, note: "예시 행입니다. 삭제 후 사용하세요.", bachelorSchool: "가상대학교", bachelorMajor: "기계공학", bachelorAbroad: "N", finalDegree: "박사", finalSchool: "Example University", finalMajor: "Mechanical Eng.", finalAbroad: "Y", overseasWorkYears: 2, overseasWorkDetail: "미국 연구소 박사후연구원", techFields: "기계 / 로봇", kpassEvalCount: 12, intlPool: "Y" });
  ws.addRow({ name: "김예시", org: "가상연구원", email: "", phone: "", expertise: "인공지능", note: "일부 항목이 비어 있어도 등록 후 보완할 수 있습니다." });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildRosterWorkbook(list: Evaluator[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("평가위원 명단");
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
  styleHeader(ws);
  const yn = (b: boolean | null) => (b == null ? "" : b ? "Y" : "N");
  list.forEach((v) => ws.addRow({ ...v, bachelorAbroad: yn(v.bachelorAbroad), finalAbroad: yn(v.finalAbroad), intlPool: yn(v.intlPool) }));
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
    { header: "학사", key: "bachelor", width: 26 },
    { header: "최종학력", key: "final", width: 30 },
    { header: "상태", key: "state", width: 14 },
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
      bachelor: v ? bachelorText(v) : "",
      final: v ? finalText(v) : "",
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
    { header: "조건부(검토 전)", key: "cond", width: 14 },
    { header: "합계", key: "total", width: 8 },
    { header: `배석 인원(${e.seats}명) 충족`, key: "meets", width: 16 },
    { header: "참석 가능 위원", key: "names", width: 50 },
  ];
  styleHeader(ws2);
  for (const s of slotSummary(e, invites)) {
    const names = [
      ...s.yes.map((id) => evaluators.get(id)?.name ?? ""),
      ...s.accepted.map((id) => `${evaluators.get(id)?.name ?? ""}(조건부 수락)`),
      ...s.conditional.map((id) => `${evaluators.get(id)?.name ?? ""}(조건 검토 전)`),
    ].join(", ");
    ws2.addRow({
      slot: formatSlot(s.slot, false),
      place: s.slot.place,
      yes: s.confirmable,
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

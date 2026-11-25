import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { __resetKvForTests } from "@/lib/store";
import { createEvaluation, importEvaluators, listEvaluators } from "@/lib/repo";
import { buildRosterWorkbook, parseEvaluatorWorkbook } from "@/lib/excel";
import { activeSanction, groupItRows, looksForeign, looseDate, type ItRow } from "@/lib/kpass";
import { DEFAULT_WEIGHTS, weightsOf } from "@/lib/types";

// 모든 이름·기관·연락처는 가상 값이다.

/** K-PASS 위원 검색 양식: 두 줄 머리글(기술분야 아래 1순위·2순위), 나머지 열은 세로 병합 */
async function searchWorkbook(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("평가위원");
  const top = ["최고평가위원여부", "평가위원선정기관구분", "성명", "지역", "생년월일", "소속기관", "직위", "연락처", "E-Mail", "전문분야", "기술분야", "", "평가횟수", "국제기술협력단평가위원여부"];
  ws.addRow(top);
  ws.addRow(top.map((_, i) => (i === 10 ? "1순위" : i === 11 ? "2순위" : "")));
  ws.mergeCells(1, 11, 1, 12); // 기술분야 가로 병합
  top.forEach((h, i) => { if (h && i !== 10) ws.mergeCells(1, i + 1, 2, i + 1); }); // 세로 병합
  rows.forEach((r) => ws.addRow(r));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** 정보화실 목록: ECMM_ID, 한 위원이 학력·경력 수만큼 여러 줄 */
async function itWorkbook(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("목록");
  ws.addRow(["ECMM_ID", "소속", "성명", "기술분야1", "기술분야2", "기술분야3", "기술분야4", "핸드폰", "제재시작일", "제재종료일", "제재사유", "순번", "학교", "전공", "학위", "근무처", "직위", "근무시작일자", "근무종료일자"]);
  rows.forEach((r) => ws.addRow(r));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const SEARCH_ROW = ["N", "산업통상자원부(e-R&D)", "가나다", "서울", "600101", "가상대학교", "교수", "010-0000-0000", "gnd@example.com", "기술정보", "패키징장비", "제조분석/평가기술", 12, "Y"];

describe("K-PASS 위원 검색 양식", () => {
  it("두 줄 머리글을 합쳐 읽고, 생년월일·연락처는 읽지 않는다", async () => {
    const r = await parseEvaluatorWorkbook(await searchWorkbook([SEARCH_ROW]));
    expect(r.format).toBe("kpass-search");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].ok).toBe(true);
    expect(r.rows[0].row).toBe(3);
    expect(r.rows[0].data).toMatchObject({
      name: "가나다", org: "가상대학교", email: "gnd@example.com", phone: "", expertise: "기술정보",
      techFields: "패키징장비 / 제조분석/평가기술", kpassEvalCount: 12, intlPool: true,
    });
    expect(r.notices.join()).toMatch(/생년월일/);
    expect(r.notices.join()).toMatch(/연락처/);
    expect(r.unmatchedHeaders).toEqual(expect.arrayContaining(["지역", "직위", "최고평가위원여부"]));
  });

  it("평가횟수가 '3회'처럼 적혀 있어도 숫자로 읽는다", async () => {
    const row = [...SEARCH_ROW];
    row[12] = "3회";
    const r = await parseEvaluatorWorkbook(await searchWorkbook([row]));
    expect(r.rows[0].data?.kpassEvalCount).toBe(3);
  });
});

describe("K-PASS 정보화실 목록", () => {
  it("한 위원의 여러 줄을 묶어 학사·최종학력·해외 근무·제재를 정리한다", async () => {
    const buf = await itWorkbook([
      ["E001", "가상연구원", "라마바", "이차전지", "소재", "", "", "010-1111-2222", "", "", "", 1, "가상대학교", "화학공학", "학사", "가상연구원", "책임", "2015-03-01", ""],
      ["E001", "가상연구원", "라마바", "이차전지", "", "", "", "010-1111-2222", "", "", "", 2, "Stanford University", "Materials Science", "박사", "Example Inc. (미국)", "연구원", "2010-01-01", "2012-01-01"],
      ["E002", "가상테크(주)", "사아자", "로봇", "", "", "", "", "2020-01-01", "2099-12-31", "협약 위반(가상)", 1, "다른가상대학교", "기계공학", "석사", "가상테크(주)", "부장", "2018-01-01", ""],
      ["E003", "가상대학교", "차카타", "", "", "", "", "", "2001-01-01", "2002-01-01", "지난 제재(가상)", 1, "", "", "", "", "", "", ""],
    ]);
    const r = await parseEvaluatorWorkbook(buf);
    expect(r.format).toBe("kpass-it");
    expect(r.rows).toHaveLength(3);
    const [a, b, c] = r.rows;
    expect(a.data).toMatchObject({
      name: "라마바", org: "가상연구원", email: "", phone: "", techFields: "이차전지 / 소재",
      bachelorSchool: "가상대학교", bachelorAbroad: false, finalDegree: "박사", finalSchool: "Stanford University", finalAbroad: true,
      overseasWorkDetail: "Example Inc. (미국)", sanction: "",
    });
    expect(a.data?.overseasWorkYears).toBeCloseTo(2, 0);
    expect(a.warnings).toContain("이메일 누락");
    // 제재 기간 중인 위원만 표시, 지난 제재는 보관하지 않음
    expect(b.data?.sanction).toMatch(/2020-01-01~2099-12-31 협약 위반/);
    expect(b.warnings.join()).toMatch(/제재 기간 중/);
    expect(b.data).toMatchObject({ finalDegree: "석사", overseasWorkYears: 0 });
    expect(c.data?.sanction).toBe("");
    expect(r.notices.join()).toMatch(/이메일이 없습니다/);
    expect(r.notices.join()).toMatch(/핸드폰/);
  });

  it("검색 양식으로 등록한 뒤 정보화실 목록을 '빈 항목만 보완'으로 올리면 같은 위원에 학력이 더해진다", async () => {
    __resetKvForTests();
    const e = await createEvaluation({
      name: "보완 테스트", department: "", contactName: "", deadline: "2030-01-01", seats: 1, requirements: "",
      slots: [{ date: "2030-01-10", start: "10:00", end: "", place: "" }], historyWeight: 50,
    });
    const s = await parseEvaluatorWorkbook(await searchWorkbook([SEARCH_ROW]));
    await importEvaluators(e.id, s.rows.map((x) => ({ row: x.row, data: x.data! })), "fill");
    const it2 = await parseEvaluatorWorkbook(
      await itWorkbook([["E9", "가상대학교", "가나다", "패키징장비", "", "", "", "", "", "", "", 1, "University of Tokyo", "공학", "박사", "", "", "", ""]]),
    );
    const res = await importEvaluators(e.id, it2.rows.map((x) => ({ row: x.row, data: x.data! })), "fill");
    expect(res[0].result).toBe("updated");
    const list = await listEvaluators(e.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: "gnd@example.com", finalSchool: "University of Tokyo", finalAbroad: true, kpassEvalCount: 12, intlPool: true });
  });
});

describe("시스템 양식과 호환", () => {
  beforeEach(() => __resetKvForTests());
  it("명단 내려받기 파일을 다시 올리면 K-PASS 항목도 그대로 돌아온다", async () => {
    const v = {
      id: "v1", name: "가", org: "나", email: "a@example.com", phone: "", expertise: "", pastInvited: 2, pastAttended: 1, preference: null, note: "",
      bachelorSchool: "", bachelorMajor: "", bachelorAbroad: null, finalDegree: "" as const, finalSchool: "", finalMajor: "", finalAbroad: null,
      overseasWorkYears: null, overseasWorkDetail: "", techFields: "로봇 / AI", kpassEvalCount: 7, intlPool: false, sanction: "",
      createdAt: "", updatedAt: "", version: 1,
    };
    const r = await parseEvaluatorWorkbook(new Uint8Array(await buildRosterWorkbook([v])).buffer);
    expect(r.format).toBe("standard");
    expect(r.unmatchedHeaders).toEqual([]);
    expect(r.rows[0].data).toMatchObject({ techFields: "로봇 / AI", kpassEvalCount: 7, intlPool: false });
  });
});

describe("해외 기관 추정·날짜", () => {
  it.each([
    ["Stanford University", true], ["University of Tokyo", true], ["MIT", true], ["도쿄대학교", true], ["미국 가상연구소", true],
    ["Fictional GmbH", true], ["Korea University", false], ["KAIST", false], ["Seoul National University", false],
    ["POSTECH", false], ["가상대학교", false], ["LG전자", false], ["", false],
  ])("%s → %s", (name, expected) => {
    expect(looksForeign(name as string)).toBe(expected);
  });
  it("여러 날짜 표기를 읽는다", () => {
    expect(looseDate("20100301")).toBe("2010-03-01");
    expect(looseDate("2010.3")).toBe("2010-03-01");
    expect(looseDate("2010/03/05")).toBe("2010-03-05");
    expect(looseDate("")).toBeNull();
    expect(looseDate("모름")).toBeNull();
  });
  it("제재 기간: 종료일이 없으면 계속 중, 지난 제재는 아님", () => {
    expect(activeSanction("2020-01-01", null, "2026-11-25")).toBe(true);
    expect(activeSanction("2020-01-01", "2021-01-01", "2026-11-25")).toBe(false);
    expect(activeSanction("2027-01-01", null, "2026-11-25")).toBe(false);
    expect(activeSanction(null, null, "2026-11-25")).toBe(false);
  });
  it("ECMM_ID가 없으면 성명·소속으로 묶는다", () => {
    const base: ItRow = { row: 2, id: "", name: "가", org: "나", tech: [], sanctionStart: null, sanctionEnd: null, sanctionReason: "", school: "", major: "", degree: "", workplace: "", workStart: null, workEnd: null };
    const people = groupItRows([base, { ...base, row: 3, school: "가상대", degree: "학사" }], "2026-11-25");
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ row: 2, bachelorSchool: "가상대", overseasWorkYears: null });
  });
});

describe("평가 가중치 기본값", () => {
  beforeEach(() => __resetKvForTests());
  it("새 평가는 객관 지표 기본 가중치, 가중치를 지정해 만든 평가는 순환 0%", async () => {
    const base = { department: "", contactName: "", deadline: "2030-01-01", seats: 1, requirements: "", slots: [], historyWeight: 50 };
    const a = await createEvaluation({ name: "새 평가", ...base });
    expect(weightsOf(a)).toEqual(DEFAULT_WEIGHTS);
    const b = await createEvaluation({ name: "지정", ...base, weights: { history: 50, preference: 30, overseas: 20 } });
    expect(weightsOf(b)).toEqual({ history: 50, preference: 30, overseas: 20, rotation: 0 });
  });
});

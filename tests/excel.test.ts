import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildTemplateWorkbook, parseEvaluatorWorkbook } from "@/lib/excel";

describe("엑셀 학력·해외경험 열", () => {
  it("등록 양식을 다시 읽으면 학력·해외 항목이 들어온다", async () => {
    const buf = await buildTemplateWorkbook();
    const { rows, unmatchedHeaders } = await parseEvaluatorWorkbook(new Uint8Array(buf).buffer);
    expect(unmatchedHeaders).toEqual([]);
    expect(rows[0].data).toMatchObject({
      bachelorSchool: "가상대학교", bachelorAbroad: false, finalDegree: "박사", finalAbroad: true, overseasWorkYears: 2,
    });
  });
  it("다른 표기(예/아니오, Ph.D, '3년')도 인식하고 잘못된 값은 오류로 표시", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["성명", "출신대학", "최종학력", "최종학교", "최종학력 해외", "해외경력"]);
    ws.addRow(["가", "한결대", "Ph.D", "MIT", "예", "3년"]);
    ws.addRow(["나", "", "", "", "모름", ""]);
    const { rows } = await parseEvaluatorWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(rows[0].data).toMatchObject({ bachelorSchool: "한결대", finalDegree: "박사", finalSchool: "MIT", finalAbroad: true, overseasWorkYears: 3 });
    expect(rows[1].ok).toBe(false);
    expect(rows[1].errors.join()).toMatch(/Y 또는 N/);
  });
});

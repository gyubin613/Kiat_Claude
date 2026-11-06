import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAll } from "../lib/mail";
import { matchAll, classifyDoc, stripQuoted } from "../lib/matcher";
import { planFiles, projectStatus, shortOrg } from "../lib/organize";
import { buildZip } from "../lib/exporter";
import { rowsToProjects } from "../lib/projects";
import { readSheet } from "../lib/readSheet";
import { DEFAULT_SETTINGS } from "../lib/settings";
import type { MailResult, ParsedMail, Project } from "../lib/types";

const S = join(__dirname, "..", "public", "samples");
let projects: Project[];
let mails: ParsedMail[];
let results: MailResult[];
const bySource = (name: string) => {
  const m = mails.find((x) => x.sourceName === name);
  if (!m) throw new Error(`no mail ${name}`);
  return { mail: m, result: results.find((r) => r.mailId === m.id)! };
};

beforeAll(async () => {
  const rows = await readSheet(new Uint8Array(readFileSync(join(S, "과제목록_가상.xlsx"))), "과제목록_가상.xlsx");
  projects = rowsToProjects(rows).projects;
  const parsed = await parseAll([{ name: "가상메일.zip", bytes: new Uint8Array(readFileSync(join(S, "가상메일.zip"))) }]);
  mails = parsed.mails;
  results = matchAll(mails, projects, DEFAULT_SETTINGS);
});

describe("과제 목록 불러오기", () => {
  it("열 이름을 인식하고 연락처를 모은다", () => {
    expect(projects).toHaveLength(30);
    const p = projects[0];
    expect(p.id).toBe("P0031001");
    expect(p.partnerOrg).toBe("Nordlicht Institute of Technology");
    expect(p.contacts).toHaveLength(2);
    expect(p.partnerContacts).toEqual(["anna.0@nordlicht.example.de"]);
  });

  it("과제번호·과제명 열이 없으면 알려준다", () => {
    const r = rowsToProjects([["이름", "메일"], ["a", "b"]]);
    expect(r.projects).toHaveLength(0);
    expect(r.warnings[0]).toContain("과제번호");
  });

  it("No 열이 있어도 과제번호 열을 쓴다", () => {
    const r = rowsToProjects([["No", "과제번호", "과제명"], ["1", "P1", "테스트 과제"]]);
    expect(r.projects[0].id).toBe("P1");
  });
});

describe("메일 읽기", () => {
  it("zip 안의 .eml을 모두 읽는다", () => {
    expect(mails).toHaveLength(43);
    const { mail } = bySource("P0031001_finance.eml");
    expect(mail.subject).toContain("재무증빙");
    expect(mail.attachments.map((a) => a.filename)).toContain("감사보고서.pdf");
  });
});

describe("과제 매칭", () => {
  it("제목에 과제번호가 있으면 자동 분류", () => {
    const { result } = bySource("P0031003_loc.eml");
    expect(result.status).toBe("auto");
    expect(result.projectId).toBe("P0031003");
  });

  it("과제번호 없이 발신자 연락처로 자동 분류", () => {
    for (let i = 1; i <= 8; i++) {
      const id = `P00${31000 + i}`;
      const { result } = bySource(`${id}_finance.eml`);
      expect(result.projectId, id).toBe(id);
      expect(result.status, id).toBe("auto");
    }
  });

  it("연락처에 없는 같은 기관 직원도 도메인+기관명으로 찾는다", () => {
    const { result } = bySource("P0031015_colleague.eml");
    expect(result.projectId).toBe("P0031015");
    expect(result.status).toBe("auto");
  });

  it("개인 메일은 과제명·기관명으로 후보를 찾되 확인 필요로 둔다", () => {
    const { result } = bySource("P0031019_gmail.eml");
    expect(result.projectId).toBe("P0031019");
    expect(result.status).toBe("review");
  });

  it("같은 해외기관 공용 주소는 후보를 여러 개 보여주고 확인 필요", () => {
    const { result } = bySource("nordlicht_shared.eml");
    expect(result.status).toBe("review");
    const ids = result.candidates.map((c) => c.projectId);
    expect(ids).toEqual(expect.arrayContaining(["P0031027", "P0031028"]));
  });

  it("답장 인용부에 있는 다른 과제번호는 무시한다", () => {
    const { result } = bySource("P0031020_reply.eml");
    expect(result.projectId).toBe("P0031020");
    expect(result.status).toBe("auto");
    expect(result.candidates.map((c) => c.projectId)).not.toContain("P0031004");
  });

  it("단서 없는 서류 메일은 미분류, 무관한 메일은 대상 아님", () => {
    expect(bySource("unknown_scan.eml").result.status).toBe("unmatched");
    for (let i = 1; i <= 5; i++) expect(bySource(`noise_${i}.eml`).result.status, `noise_${i}`).toBe("excluded");
  });

  it("자동 분류된 과제가 실제 과제와 모두 일치한다", () => {
    const autos = results.filter((r) => r.status === "auto");
    for (const r of autos) {
      const m = mails.find((x) => x.id === r.mailId)!;
      const expected = /^(P\d+)_/.exec(m.sourceName)?.[1];
      expect(r.projectId, m.sourceName).toBe(expected);
    }
    expect(autos.length).toBeGreaterThanOrEqual(33);
  });
});

describe("서류 종류", () => {
  it("파일명으로 서류 종류를 나눈다", () => {
    const { result } = bySource("P0031010_bundle.eml");
    expect(result.attachments.map((a) => a.docType)).toEqual(["참여확약서", "협약서"]);
    const fin = bySource("P0031002_finance.eml").result;
    expect(fin.attachments.every((a) => a.docType === "재무증빙")).toBe(true);
  });

  it("짧은 약어는 단어 단위로만 인정 (location ≠ LOC)", () => {
    expect(classifyDoc("office location map", DEFAULT_SETTINGS)).toBeNull();
    expect(classifyDoc("signed LOC", DEFAULT_SETTINGS)?.type).toBe("참여확약서");
  });

  it("인용부를 잘라낸다", () => {
    expect(stripQuoted("hello\n\n-----Original Message-----\nold")).toBe("hello");
    expect(stripQuoted("hi\n> quoted\nbye")).toBe("hi\nbye");
  });
});

describe("정리 결과", () => {
  it("과제별 제출 현황", () => {
    const st = projectStatus(mails, results, projects, DEFAULT_SETTINGS);
    const get = (id: string) => st.find((s) => s.project.id === id)!;
    expect(get("P0031001").state).toBe("완료");
    expect(get("P0031009").state).toBe("일부 제출");
    expect(get("P0031009").missing).toEqual(["재무증빙"]);
    expect(get("P0031025").state).toBe("미제출");
  });

  it("폴더·파일 이름 규칙", () => {
    const plan = planFiles(mails, results, projects);
    const f = plan.find((x) => x.originalName === "감사보고서.pdf" && x.projectId === "P0031001")!;
    expect(f.path).toMatch(/^P0031001_.+\/재무증빙\/P0031001_한빛로보틱스_재무증빙_2026\d{4}_감사보고서\.pdf$/);
    const loc = plan.find((x) => x.projectId === "P0031001" && x.docType === "참여확약서")!;
    expect(loc.standardName).toMatch(/^P0031001_Nordlicht Institute_참여확약서_20261130_/);
    const paths = plan.map((x) => x.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.some((p) => p.startsWith("01_확인필요/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("00_미분류/"))).toBe(true);
    // 대상 아님 메일은 내보내지 않음
    expect(plan.some((x) => x.originalName.startsWith("noise_"))).toBe(false);
  });

  it("짧은 기관명", () => {
    expect(shortOrg("(주)한빛로보틱스")).toBe("한빛로보틱스");
    expect(shortOrg("Nordlicht Institute of Technology")).toBe("Nordlicht Institute");
    expect(shortOrg("Cascadia Advanced Materials Inc.")).toBe("Cascadia Advanced");
  });

  it("ZIP 안에 엑셀과 정리된 파일이 들어간다", async () => {
    const { zip, plan } = await buildZip({ mails, results, projects, settings: DEFAULT_SETTINGS });
    const z = await JSZip.loadAsync(zip);
    const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
    expect(names.length).toBe(plan.length + 1);
    const xlsxName = names.find((n) => n.endsWith(".xlsx"))!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await z.file(xlsxName)!.async("uint8array")).buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["제출현황", "메일목록", "첨부파일목록"]);
    expect(wb.getWorksheet("제출현황")!.rowCount).toBe(31);
    expect(wb.getWorksheet("메일목록")!.rowCount).toBe(44);
  });
});

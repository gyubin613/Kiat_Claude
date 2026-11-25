import { describe, expect, it } from "vitest";
import { nextStep, stepDone, type GuideEvaluation } from "@/lib/guide";
import { matchPhones, normalizePhone, pasteText, phoneEntriesFromRows, smsBytes, smsTemplate } from "@/lib/sms";
import { monthCells } from "@/lib/calendar";

const zero = { total: 0, notSent: 0, waiting: 0, yes: 0, conditional: 0, condPending: 0, no: 0, withdrawn: 0, responded: 0 };
const ev = (p: Partial<Omit<GuideEvaluation, "counts">> & { counts?: Partial<GuideEvaluation["counts"]> } = {}): GuideEvaluation => ({
  id: "e1", slots: [{ id: "s", date: "2030-01-10", start: "10:00", end: "", place: "" }], seats: 3, status: "draft",
  recruitMode: "auto", autoRunning: false, deadline: "2030-01-01", rosterCount: 10, unread: 0, overdue: 0,
  ...p, counts: { ...zero, ...(p.counts ?? {}) },
});

describe("지금 할 일 안내", () => {
  it("업무 순서대로 다음 단계를 안내한다", () => {
    expect(nextStep(ev({ slots: [] })).step).toBe(1);
    expect(nextStep(ev({ rosterCount: 0 }))).toMatchObject({ step: 2, href: "/admin/evaluators?e=e1" });
    expect(nextStep(ev()).title).toMatch(/순차 자동 초청 시작/);
    expect(nextStep(ev({ recruitMode: "manual" })).title).toMatch(/3명 더/);
    expect(nextStep(ev({ recruitMode: "manual", counts: { total: 3, notSent: 2, waiting: 1 } })).step).toBe(4);
    expect(nextStep(ev({ autoRunning: true, counts: { total: 3, waiting: 3 } }))).toMatchObject({ step: 5, waiting: true });
  });
  it("조건부 답변·문의가 있으면 그것부터, 인원이 차면 확정", () => {
    expect(nextStep(ev({ autoRunning: true, counts: { total: 3, yes: 3, conditional: 1, condPending: 1 } })).step).toBe(5);
    expect(nextStep(ev({ autoRunning: true, unread: 2, counts: { total: 3, waiting: 3 } })).href).toMatch(/messages/);
    expect(nextStep(ev({ autoRunning: true, counts: { total: 4, yes: 2, conditional: 1, condPending: 0 } })).step).toBe(6);
    expect(nextStep(ev({ status: "finalized" })).cta).toBe("확정 안내 보내기");
  });
  it("오래 무응답이면 문자 알림을 권한다", () => {
    expect(nextStep(ev({ autoRunning: true, overdue: 2, counts: { total: 3, waiting: 3 } })).detail).toMatch(/문자 알림 준비/);
  });
  it("메뉴 완료 표시: 불참·철회는 초청 인원에서 빠진다", () => {
    expect(stepDone(ev({ recruitMode: "manual", counts: { total: 3, no: 1 } }), 3)).toBe(false);
    expect(stepDone(ev({ recruitMode: "manual", counts: { total: 3 } }), 3)).toBe(true);
  });
});

describe("문자 알림 준비", () => {
  it("휴대폰 번호를 000-0000-0000으로 맞추고 휴대폰이 아니면 버린다", () => {
    expect(normalizePhone("01012345678")).toBe("010-1234-5678");
    expect(normalizePhone("010 1234 5678")).toBe("010-1234-5678");
    expect(normalizePhone("+82 10-1234-5678")).toBe("010-1234-5678");
    expect(normalizePhone("011-123-4567")).toBe("011-123-4567");
    expect(normalizePhone("02-6009-0000")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("문자 길이는 한글 2바이트·영문 1바이트", () => {
    expect(smsBytes("가a1")).toBe(4);
  });
  it("K-PASS 위원 검색 양식(두 줄 머리글)에서 성명·소속·연락처를 찾는다", () => {
    const rows = [
      ["최고평가위원여부", "성명", "생년월일", "소속기관", "연락처", "E-Mail", "기술분야", ""],
      ["최고평가위원여부", "성명", "생년월일", "소속기관", "연락처", "E-Mail", "1순위", "2순위"],
      ["N", "가나다", "600101", "가상대학교", "010-0000-0001", "a@example.com", "x", "y"],
      ["N", "라마바", "600101", "가상연구원", "", "b@example.com", "x", "y"],
    ];
    expect(phoneEntriesFromRows(rows)).toEqual([{ name: "가나다", org: "가상대학교", phone: "010-0000-0001" }]);
  });
  it("정보화실 목록(핸드폰 열, 한 위원 여러 줄)도 읽는다", () => {
    const rows = [["ECMM_ID", "소속", "성명", "핸드폰"], ["E1", "가상(주)", "사아자", "01000000002"], ["E1", "가상(주)", "사아자", "01000000002"]];
    expect(phoneEntriesFromRows(rows)[0]).toEqual({ name: "사아자", org: "가상(주)", phone: "010-0000-0002" });
  });
  it("위원 정보 번호 → 성명·소속 일치 → 같은 성명이 한 명뿐일 때 순서로 번호를 찾는다", () => {
    const entries = [
      { name: "가나다", org: "가상대학교", phone: "010-0000-0001" },
      { name: "가나다", org: "다른기관", phone: "010-0000-0009" },
      { name: "라마바", org: "아무기관", phone: "010-0000-0003" },
    ];
    const m = matchPhones(
      [
        { id: "1", name: "가나다", org: "가상 대학교", phone: "" },
        { id: "2", name: "라마바", org: "가상연구원", phone: "" },
        { id: "3", name: "사아자", org: "가상(주)", phone: "010-1111-2222" },
        { id: "4", name: "차카타", org: "", phone: "" },
      ],
      entries,
    );
    expect(m.map((x) => [x.phone, x.found])).toEqual([
      ["010-0000-0001", "file"], ["010-0000-0003", "file"], ["010-1111-2222", "stored"], ["", "none"],
    ]);
    expect(pasteText(m)).toBe("010-0000-0001\t가나다\t가상 대학교\n010-0000-0003\t라마바\t가상연구원\n010-1111-2222\t사아자\t가상(주)");
  });
  it("대상별 기본 문구에 평가명·기한·담당자가 들어간다", () => {
    const t = smsTemplate({ name: "시험 평가", deadline: "2030-01-01", contactName: "홍길동" }, "waiting");
    expect(t).toMatch(/시험 평가/);
    expect(t).toMatch(/2030\. 1\. 1\./);
    expect(t).toMatch(/문의: 홍길동/);
    expect(smsTemplate({ name: "가", deadline: "2030-01-01", contactName: "" }, "attending")).not.toMatch(/문의/);
  });
});

describe("후보 일정 달력", () => {
  it("요일에 맞춰 빈칸을 넣고 7칸 단위로 채운다", () => {
    const cells = monthCells("2026-12"); // 2026-12-01은 화요일
    expect(cells.slice(0, 3)).toEqual([null, null, "2026-12-01"]);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(31);
  });
});

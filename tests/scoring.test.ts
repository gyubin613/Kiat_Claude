import { describe, expect, it } from "vitest";
import { historyScore, rankEvaluators, scoreEvaluator } from "@/lib/scoring";
import { EDUCATION_DEFAULTS, type Evaluator } from "@/lib/types";
import { overseasScore } from "@/lib/scoring";
import { conflictHits, finalText } from "@/lib/profile";

const ev = (p: Partial<Evaluator>): Evaluator => ({
  id: p.id ?? "x", name: p.name ?? "가", org: "", email: "", phone: "", expertise: "", note: "",
  ...EDUCATION_DEFAULTS, pastInvited: null, pastAttended: null, preference: null, createdAt: "", updatedAt: "", version: 1, ...p,
});

describe("우선순위 참고 점수", () => {
  it("이력이 없으면 중립값 0.5", () => {
    expect(historyScore({ pastInvited: null, pastAttended: null })).toEqual({ value: 0.5, neutral: true });
    expect(historyScore({ pastInvited: 0, pastAttended: 0 }).neutral).toBe(true);
  });
  it("표본이 적은 경우 극단값을 완화 (라플라스 보정)", () => {
    expect(historyScore({ pastInvited: 1, pastAttended: 1 }).value).toBeCloseTo(2 / 3);
    expect(historyScore({ pastInvited: 10, pastAttended: 10 }).value).toBeGreaterThan(2 / 3);
  });
  it("참여 횟수가 초청 횟수를 넘으면 초청 횟수로 제한", () => {
    expect(historyScore({ pastInvited: 2, pastAttended: 5 }).value).toBeCloseTo(3 / 4);
  });
  it("가중치에 따라 종합 점수가 달라진다", () => {
    const a = { pastInvited: 10, pastAttended: 9, preference: 1 };
    expect(scoreEvaluator(a, 100).total).toBeGreaterThan(scoreEvaluator(a, 0).total);
    expect(scoreEvaluator(a, 0).total).toBe(0);
    expect(scoreEvaluator({ pastInvited: null, pastAttended: null, preference: null }, 50).total).toBe(50);
  });
  it("동점이면 참여 횟수 → 성명 순 정렬", () => {
    const r = rankEvaluators([ev({ id: "1", name: "나" }), ev({ id: "2", name: "가" })], 50);
    expect(r.map((x) => x.id)).toEqual(["2", "1"]);
    expect(r[0].rank).toBe(1);
  });
});

describe("해외경험 점수", () => {
  it("모두 미입력이면 중립, 해외 대학·해외 근무를 반영", () => {
    expect(overseasScore({})).toEqual({ value: 0.5, neutral: true });
    expect(overseasScore({ bachelorAbroad: false, finalAbroad: false, overseasWorkYears: 0 }).value).toBe(0);
    expect(overseasScore({ finalAbroad: true }).value).toBe(0.5);
    expect(overseasScore({ finalAbroad: true, overseasWorkYears: 3 }).value).toBe(1);
    expect(overseasScore({ overseasWorkYears: 1.5 }).value).toBeCloseTo(0.25);
  });
  it("세 가지 가중치를 비율로 반영", () => {
    const abroad = { pastInvited: null, pastAttended: null, preference: null, finalAbroad: true, overseasWorkYears: 5 };
    const local = { pastInvited: null, pastAttended: null, preference: null, bachelorAbroad: false, finalAbroad: false, overseasWorkYears: 0 };
    const w = { history: 0, preference: 0, overseas: 100 };
    expect(scoreEvaluator(abroad, w).total).toBe(100);
    expect(scoreEvaluator(local, w).total).toBe(0);
    expect(scoreEvaluator(abroad, { history: 50, preference: 50, overseas: 0 }).total).toBe(50);
    expect(scoreEvaluator(abroad, { history: 0, preference: 0, overseas: 0 }).total).toBeCloseTo(66.7, 1);
  });
});

describe("학력 표시·이해관계 확인", () => {
  it("최종학력이 학사와 같으면 생략", () => {
    expect(finalText({ bachelorSchool: "가대", finalDegree: "학사", finalSchool: "가대" })).toBe("");
    expect(finalText({ finalDegree: "박사", finalSchool: "MIT", finalMajor: "EE", finalAbroad: true })).toBe("박사 MIT (EE) · 해외");
  });
  it("소속·학교에 피평가 기관명이 포함되면 표시", () => {
    const v = { org: "다온테크(주)", bachelorSchool: "한결대학교", finalSchool: "" };
    expect(conflictHits(v, ["다온테크"]).map((h) => h.field)).toEqual(["소속"]);
    expect(conflictHits(v, ["한결대학교 산학협력단"]).map((h) => h.field)).toEqual(["학사"]);
    expect(conflictHits(v, ["누리"])).toEqual([]);
    expect(conflictHits(v, [])).toEqual([]);
  });
});

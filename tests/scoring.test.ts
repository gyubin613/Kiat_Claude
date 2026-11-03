import { describe, expect, it } from "vitest";
import { historyScore, rankEvaluators, scoreEvaluator } from "@/lib/scoring";
import type { Evaluator } from "@/lib/types";

const ev = (p: Partial<Evaluator>): Evaluator => ({
  id: p.id ?? "x", name: p.name ?? "가", org: "", email: "", phone: "", expertise: "", note: "",
  pastInvited: null, pastAttended: null, preference: null, createdAt: "", updatedAt: "", version: 1, ...p,
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

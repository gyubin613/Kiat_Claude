import type { Evaluator } from "./types";

/**
 * 섭외 우선순위 참고 점수
 *
 * - 과거 이력 점수: (참여 + 1) / (초청 + 2)  ← 라플라스 보정.
 *   이력이 없으면 0.5(중립)이며, 초청 1회·참여 1회처럼 표본이 적은 경우 극단값을 완화한다.
 * - 관리자 선호도 점수: (선호도 - 1) / 4, 미입력 시 3점(중립 = 0.5)
 * - 종합 점수 = 100 × (이력가중치 × 이력점수 + (100 - 이력가중치) × 선호도점수) / 100
 *
 * ※ 이 점수는 섭외 순서 검토용 참고자료이며, 실제 참석 가능성을 예측·보증하지 않는다.
 */
export type ScoreBreakdown = {
  history: number; // 0~1
  historyIsNeutral: boolean;
  preference: number; // 0~1
  preferenceIsNeutral: boolean;
  total: number; // 0~100 (소수점 1자리)
};

export function historyScore(ev: Pick<Evaluator, "pastInvited" | "pastAttended">) {
  const invited = ev.pastInvited ?? 0;
  const attended = Math.min(ev.pastAttended ?? 0, invited);
  if (invited <= 0) return { value: 0.5, neutral: true };
  return { value: (attended + 1) / (invited + 2), neutral: false };
}

export function preferenceScore(ev: Pick<Evaluator, "preference">) {
  if (ev.preference == null) return { value: 0.5, neutral: true };
  const p = Math.max(1, Math.min(5, ev.preference));
  return { value: (p - 1) / 4, neutral: false };
}

export function scoreEvaluator(
  ev: Pick<Evaluator, "pastInvited" | "pastAttended" | "preference">,
  historyWeight: number,
): ScoreBreakdown {
  const w = Math.max(0, Math.min(100, historyWeight)) / 100;
  const h = historyScore(ev);
  const p = preferenceScore(ev);
  const total = Math.round((w * h.value + (1 - w) * p.value) * 1000) / 10;
  return {
    history: h.value,
    historyIsNeutral: h.neutral,
    preference: p.value,
    preferenceIsNeutral: p.neutral,
    total,
  };
}

export type Ranked<T> = T & { score: ScoreBreakdown; rank: number };

/** 점수 내림차순, 동점이면 참여 횟수 → 성명 순으로 안정 정렬 */
export function rankEvaluators<T extends Evaluator>(list: T[], historyWeight: number): Ranked<T>[] {
  return list
    .map((ev) => ({ ...ev, score: scoreEvaluator(ev, historyWeight) }))
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        (b.pastAttended ?? 0) - (a.pastAttended ?? 0) ||
        a.name.localeCompare(b.name, "ko"),
    )
    .map((ev, i) => ({ ...ev, rank: i + 1 }));
}

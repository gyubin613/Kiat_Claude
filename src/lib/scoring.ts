import type { Evaluator, Weights } from "./types";

/**
 * 섭외 우선순위 참고 점수
 *
 * - 과거 이력: (참여 + 1) / (초청 + 2)  ← 라플라스 보정. 이력이 없으면 0.5(중립)
 * - 관리자 선호도: (선호도 - 1) / 4, 미입력 시 3점(중립 = 0.5)
 * - 해외경험: 해외 대학(학사 또는 최종학력) 50% + 해외 근무 경력 50% (3년 이상이면 만점)
 *   해외 관련 항목이 모두 미입력이면 중립 0.5, 일부만 입력되면 미입력 항목은 '없음'으로 계산
 * - 종합 점수 = 100 × Σ(가중치 × 점수) / Σ가중치
 *
 * ※ 이 점수는 섭외 순서 검토용 참고자료이며, 실제 참석 가능성을 예측·보증하지 않는다.
 */
export type ScoreBreakdown = {
  history: number; // 0~1
  historyIsNeutral: boolean;
  preference: number;
  preferenceIsNeutral: boolean;
  overseas: number;
  overseasIsNeutral: boolean;
  total: number; // 0~100 (소수점 1자리)
};

export const OVERSEAS_FULL_YEARS = 3;

type ScoreInput = Pick<Evaluator, "pastInvited" | "pastAttended" | "preference"> &
  Partial<Pick<Evaluator, "bachelorAbroad" | "finalAbroad" | "overseasWorkYears">>;

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

export function overseasScore(ev: Partial<Pick<Evaluator, "bachelorAbroad" | "finalAbroad" | "overseasWorkYears">>) {
  const b = ev.bachelorAbroad ?? null;
  const f = ev.finalAbroad ?? null;
  const y = ev.overseasWorkYears ?? null;
  if (b === null && f === null && y === null) return { value: 0.5, neutral: true };
  const univ = b === true || f === true ? 1 : 0;
  const work = y && y > 0 ? Math.min(y, OVERSEAS_FULL_YEARS) / OVERSEAS_FULL_YEARS : 0;
  return { value: 0.5 * univ + 0.5 * work, neutral: false };
}

export function normalizeWeights(w: Weights) {
  const h = Math.max(0, w.history), p = Math.max(0, w.preference), o = Math.max(0, w.overseas);
  const sum = h + p + o;
  if (sum <= 0) return { history: 1 / 3, preference: 1 / 3, overseas: 1 / 3 };
  return { history: h / sum, preference: p / sum, overseas: o / sum };
}

/** weights 에 숫자만 넘기면 (이전 방식) 과거 이력 가중치로 해석 */
export function scoreEvaluator(ev: ScoreInput, weights: Weights | number): ScoreBreakdown {
  const w = normalizeWeights(
    typeof weights === "number" ? { history: weights, preference: 100 - weights, overseas: 0 } : weights,
  );
  const h = historyScore(ev);
  const p = preferenceScore(ev);
  const o = overseasScore(ev);
  const total = Math.round((w.history * h.value + w.preference * p.value + w.overseas * o.value) * 1000) / 10;
  return {
    history: h.value,
    historyIsNeutral: h.neutral,
    preference: p.value,
    preferenceIsNeutral: p.neutral,
    overseas: o.value,
    overseasIsNeutral: o.neutral,
    total,
  };
}

export type Ranked<T> = T & { score: ScoreBreakdown; rank: number };

/** 점수 내림차순, 동점이면 참여 횟수 → 성명 순으로 안정 정렬 */
export function rankEvaluators<T extends Evaluator>(list: T[], weights: Weights | number): Ranked<T>[] {
  return list
    .map((ev) => ({ ...ev, score: scoreEvaluator(ev, weights) }))
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        (b.pastAttended ?? 0) - (a.pastAttended ?? 0) ||
        a.name.localeCompare(b.name, "ko"),
    )
    .map((ev, i) => ({ ...ev, rank: i + 1 }));
}

/**
 * 자동 섭외 순서: 담당자가 끌어서 정한 순서(autoQueue)를 먼저, 그 뒤에 아직 순서에 없는 위원을 점수순으로.
 * 제외(autoExcluded)한 위원은 빠진다. (서버·화면 공용)
 */
export function autoOrder<T extends Evaluator>(
  roster: T[],
  e: { autoQueue?: string[]; autoExcluded?: string[] },
  weights: Weights | number,
): Ranked<T>[] {
  const ranked = rankEvaluators(roster, weights);
  const byId = new Map(ranked.map((v) => [v.id, v]));
  const excluded = new Set(e.autoExcluded ?? []);
  const queued = (e.autoQueue ?? []).filter((id) => byId.has(id) && !excluded.has(id));
  const seen = new Set(queued);
  return [...queued.map((id) => byId.get(id)!), ...ranked.filter((v) => !seen.has(v.id) && !excluded.has(v.id))];
}

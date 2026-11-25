// 화면 안내: 평가 상태를 보고 "지금 할 일"을 하나 정한다 (서버·화면 공용, 순수 함수)
import type { Evaluation } from "./types";
import type { inviteCounts } from "./summary";

export type GuideEvaluation = Pick<Evaluation, "id" | "slots" | "seats" | "status" | "recruitMode" | "autoRunning" | "deadline"> & {
  counts: ReturnType<typeof inviteCounts>;
  rosterCount: number;
  unread: number;
  overdue: number;
};

/** 업무 단계 (메뉴 순서와 같음) */
export const STEPS = [
  { step: 1, href: "/admin", label: "평가 등록", phase: "준비" },
  { step: 2, href: "/admin/evaluators", label: "평가위원 명단", phase: "준비" },
  { step: 3, href: "/admin/priority", label: "초청 위원·순서", phase: "섭외" },
  { step: 4, href: "/admin/invites", label: "초청 메일", phase: "섭외" },
  { step: 5, href: "/admin/responses", label: "회신 현황", phase: "섭외" },
  { step: 6, href: "/admin/finalize", label: "최종 확정", phase: "확정" },
] as const;

export type StepNo = (typeof STEPS)[number]["step"];

export type NextStep = {
  step: StepNo;
  title: string; // 한 줄로 무엇을 할지
  detail: string; // 왜·어떻게
  cta: string; // 버튼 문구
  href: string; // 이동할 화면 (평가 id 포함)
  waiting?: boolean; // 할 일 없이 기다리는 중
};

export function confirmableCount(e: Pick<GuideEvaluation, "counts">) {
  const c = e.counts;
  return c.yes + (c.conditional - c.condPending);
}

/** 지금 할 일 하나 (우선순위 순서대로 처음 맞는 것) */
export function nextStep(e: GuideEvaluation): NextStep {
  const q = `?e=${e.id}`;
  const c = e.counts;
  const go = (step: StepNo) => `${STEPS[step - 1].href}${q}`;
  const auto = e.recruitMode === "auto";
  const active = c.total - c.withdrawn - c.no; // 아직 참석 가능성이 있는 초청
  const confirmable = confirmableCount(e);

  if (e.status === "finalized")
    return {
      step: 6,
      title: "최종 확정을 마쳤습니다",
      detail: "확정만으로는 위원에게 메일이 가지 않습니다. 위원 문의·안내에서 '참석 가능 회신 위원'에게 확정 안내를 보내 주세요.",
      cta: "확정 안내 보내기",
      href: `/admin/messages${q}`,
    };
  if (!e.slots.length)
    return { step: 1, title: "후보 일정을 등록해 주세요", detail: "위원에게 물어볼 평가 날짜·시간을 먼저 정합니다.", cta: "평가 수정", href: go(1) };
  if (!e.rosterCount)
    return {
      step: 2,
      title: "평가위원 명단을 올려 주세요",
      detail: "K-PASS에서 내려받은 엑셀을 그대로 올리거나, 이전 평가의 명단을 불러옵니다.",
      cta: "명단 올리기",
      href: go(2),
    };
  if (c.condPending)
    return {
      step: 5,
      title: `조건부 참석 ${c.condPending}건에 답변해 주세요`,
      detail: "위원이 남긴 조건·문의에 답하며 수락 또는 거절을 정합니다. 수락한 위원만 확정할 수 있습니다.",
      cta: "답변하기",
      href: go(5),
    };
  if (e.unread)
    return { step: 5, title: `위원 문의 ${e.unread}건에 답변해 주세요`, detail: "답변은 위원 회신 화면과 메일로 전달됩니다.", cta: "답변하기", href: `/admin/messages${q}` };
  if (confirmable >= e.seats)
    return {
      step: 6,
      title: `참석 가능 위원이 ${e.seats}명을 채웠습니다 — 최종 확정해 주세요`,
      detail: "일정별 가능 인원을 보고 평가 일시와 참석 위원을 확정합니다.",
      cta: "최종 확정",
      href: go(6),
    };
  if (auto && !e.autoRunning)
    return {
      step: 3,
      title: "초청 순서를 확인하고 [순차 자동 초청 시작]을 눌러 주세요",
      detail: `시작하면 앞 순서 ${e.seats}명에게 메일이 바로 나가고, 불참·무응답이면 다음 순서로 자동으로 넘어갑니다.`,
      cta: "순서 정하기",
      href: go(3),
    };
  if (!auto && active < e.seats)
    return {
      step: 3,
      title: `초청할 위원을 ${e.seats - Math.max(0, active)}명 더 골라 주세요`,
      detail: "참고 점수 순서로 정렬되어 있습니다. 고른 위원은 초청 메일 화면에서 메일을 보냅니다.",
      cta: "위원 고르기",
      href: go(3),
    };
  if (c.notSent)
    return {
      step: 4,
      title: `초청 메일을 보내지 않은 위원 ${c.notSent}명이 있습니다`,
      detail: "초청 메일 화면에서 미리보기를 확인하고 보냅니다.",
      cta: "메일 보내기",
      href: go(4),
    };
  return {
    step: 5,
    title: c.waiting ? `위원 회신을 기다리는 중입니다 (회신 대기 ${c.waiting}명)` : "위원 회신을 기다리는 중입니다",
    detail:
      e.overdue > 0
        ? `회신이 오래 없는 위원이 ${e.overdue}명 있습니다. 회신 현황에서 [문자 알림 준비]로 기관 문자 발송용 목록을 만들 수 있습니다.`
        : auto
          ? "불참·무응답이 생기면 다음 순서 위원에게 자동으로 메일이 나갑니다. 회신이 들어오면 일정별 인원이 자동으로 집계됩니다."
          : "회신이 들어오면 일정별 인원이 자동으로 집계됩니다.",
    cta: "회신 현황 보기",
    href: go(5),
    waiting: true,
  };
}

/** 메뉴에 표시할 단계별 완료 여부 */
export function stepDone(e: GuideEvaluation, step: StepNo) {
  const c = e.counts;
  switch (step) {
    case 1: return e.slots.length > 0;
    case 2: return e.rosterCount > 0;
    case 3: return c.total - c.withdrawn - c.no >= e.seats || (e.recruitMode === "auto" && !!e.autoRunning);
    case 4: return c.total > 0 && c.notSent === 0;
    case 5: return c.total > 0 && c.waiting === 0 && c.notSent === 0 && c.condPending === 0;
    case 6: return e.status === "finalized";
  }
}

/** 화면별 도움말 (이 화면에서 하는 일, 2~3줄) */
export const PAGE_HELP: Record<StepNo, { title: string; lines: string[] }> = {
  1: {
    title: "평가 등록",
    lines: [
      "[새 평가 등록]에서 평가명 → 후보 일정 → 회신 기한·섭외 방식 순서로 입력합니다.",
      "이미 등록한 평가는 목록의 [⋯ → 수정]에서 바꿀 수 있습니다.",
      "위에 보이는 '지금 할 일'을 따라가면 다음 화면으로 이어집니다.",
    ],
  },
  2: {
    title: "평가위원 명단",
    lines: [
      "K-PASS에서 내려받은 엑셀(위원 검색 양식·정보화실 목록)을 [엑셀로 추가·업데이트]로 그대로 올립니다.",
      "이전 평가의 명단을 불러오거나, 한 명씩 직접 추가할 수도 있습니다.",
      "이메일이 없는 위원에게는 초청 메일을 보낼 수 없으니 확인해 주세요.",
    ],
  },
  3: {
    title: "초청 위원·순서",
    lines: [
      "참고 점수 순서로 정렬되어 있습니다. 점수는 참고자료이며 초청 여부는 담당자가 정합니다.",
      "순차 자동 초청: 위원을 끌어서 순서를 정하고 [순차 자동 초청 시작]을 누릅니다.",
      "직접 골라 초청: 위원을 체크하고 [초청 대상에 추가]를 누른 뒤 초청 메일 화면으로 갑니다.",
    ],
  },
  4: {
    title: "초청 메일",
    lines: [
      "메일 양식은 한 번만 작성하면 위원별 이름·후보 일정·회신 링크가 자동으로 들어갑니다.",
      "[미리보기]로 내용을 확인하고 보냅니다. 순차 자동 초청은 이 화면을 거치지 않고 자동으로 나갑니다.",
    ],
  },
  5: {
    title: "회신 현황",
    lines: [
      "위원이 휴대전화로 회신하면 자동으로 반영되고, 일정별 가능·부족 인원이 계산됩니다.",
      "조건부 참석은 답변하며 수락·거절을 정합니다. 회신이 늦은 위원은 [문자 알림 준비]로 기관 문자를 보낼 수 있습니다.",
    ],
  },
  6: {
    title: "최종 확정",
    lines: [
      "일정별 가능 인원을 보고 평가 일시와 참석 위원을 고른 뒤 확정합니다.",
      "확정 후에는 바꿀 수 없습니다. 확정 안내는 위원 문의·안내에서 따로 보내 주세요.",
    ],
  },
};

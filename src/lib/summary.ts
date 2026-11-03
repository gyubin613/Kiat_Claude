// 회신 집계 (서버·브라우저 공용 순수 함수)
import { conditionAccepted, type AnnouncementAudience, type Evaluation, type Invite } from "./types";


/** 참석 가능(확정 후보)으로 볼 수 있는 회신: '참석 가능' 또는 관리자가 수락한 '조건부' */
export function isConfirmable(i: Invite) {
  if (i.status === "withdrawn" || !i.response) return false;
  return i.response.attendance === "yes" || conditionAccepted(i);
}

/** 조건부 회신 중 아직 검토하지 않은 것 */
export function isConditionPending(i: Invite) {
  return i.status !== "withdrawn" && i.response?.attendance === "conditional" && !i.conditionReview;
}

/** 거절된 조건부 회신은 불참과 같이 취급 */
export function isDeclined(i: Invite) {
  return i.response?.attendance === "no" || (i.response?.attendance === "conditional" && i.conditionReview?.decision === "rejected");
}

export function slotSummary(evaluation: Evaluation, invites: Invite[]) {
  const active = invites.filter((i) => i.status !== "withdrawn");
  return evaluation.slots.map((slot) => {
    const on = (i: Invite) => !!i.response?.slotIds.includes(slot.id);
    const yes = active.filter((i) => on(i) && i.response?.attendance === "yes");
    const accepted = active.filter((i) => on(i) && conditionAccepted(i));
    const pending = active.filter((i) => on(i) && isConditionPending(i));
    const confirmable = yes.length + accepted.length;
    return {
      slot,
      yes: yes.map((i) => i.evaluatorId),
      accepted: accepted.map((i) => i.evaluatorId), // 조건부 · 수락
      conditional: pending.map((i) => i.evaluatorId), // 조건부 · 검토 필요
      confirmable,
      total: confirmable + pending.length,
      meetsSeats: confirmable >= evaluation.seats,
      meetsSeatsWithConditional: confirmable + pending.length >= evaluation.seats,
    };
  });
}

export function inviteCounts(invites: Invite[]) {
  const c = { total: invites.length, notSent: 0, waiting: 0, yes: 0, conditional: 0, condPending: 0, no: 0, withdrawn: 0, responded: 0 };
  for (const i of invites) {
    if (i.status === "withdrawn") c.withdrawn++;
    else if (i.response) {
      c.responded++;
      if (isDeclined(i)) c.no++;
      else if (i.response.attendance === "yes") c.yes++;
      else {
        c.conditional++;
        if (!i.conditionReview) c.condPending++;
      }
    } else if (i.status === "sent") c.waiting++;
    else c.notSent++;
  }
  return c;
}

/** 안내 대상 위원 선별 */
export function audienceOfClient(invites: Invite[], audience: AnnouncementAudience) {
  return invites.filter((i) => {
    if (i.status === "withdrawn") return false;
    if (audience === "waiting") return !i.response;
    if (audience === "attending") return !!i.response && !isDeclined(i);
    return true;
  });
}

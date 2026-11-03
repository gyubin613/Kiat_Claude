// 회신 집계 (서버·브라우저 공용 순수 함수)
import type { AnnouncementAudience, Evaluation, Invite } from "./types";


export function slotSummary(evaluation: Evaluation, invites: Invite[]) {
  const active = invites.filter((i) => i.status !== "withdrawn");
  return evaluation.slots.map((slot) => {
    const yes = active.filter((i) => i.response?.attendance === "yes" && i.response.slotIds.includes(slot.id));
    const cond = active.filter((i) => i.response?.attendance === "conditional" && i.response.slotIds.includes(slot.id));
    return {
      slot,
      yes: yes.map((i) => i.evaluatorId),
      conditional: cond.map((i) => i.evaluatorId),
      total: yes.length + cond.length,
      meetsSeats: yes.length >= evaluation.seats,
      meetsSeatsWithConditional: yes.length + cond.length >= evaluation.seats,
    };
  });
}

export function inviteCounts(invites: Invite[]) {
  const c = { total: invites.length, notSent: 0, waiting: 0, yes: 0, conditional: 0, no: 0, withdrawn: 0, responded: 0 };
  for (const i of invites) {
    if (i.status === "withdrawn") c.withdrawn++;
    else if (i.response) {
      c.responded++;
      c[i.response.attendance === "conditional" ? "conditional" : i.response.attendance]++;
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
    if (audience === "attending") return !!i.response && i.response.attendance !== "no";
    return true;
  });
}

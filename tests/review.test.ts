import { beforeEach, describe, expect, it } from "vitest";
import { __resetKvForTests } from "@/lib/store";
import {
  applyInviteAction, createEvaluation, createEvaluator, createInvites, finalizeEvaluation, getEvaluation, listInvites, reviewCondition, submitResponse,
} from "@/lib/repo";
import { inviteCounts, slotSummary } from "@/lib/summary";
import { createAnnouncement, getThread, postAdminMessage, postEvaluatorMessage } from "@/lib/comm";
import { pendingQuestion, inviteDisplayState } from "@/lib/types";
import { planFollowup } from "@/lib/followup";
import { evaluatorInput } from "@/lib/validate";
import type { Evaluator } from "@/lib/types";

async function setup() {
  const e = await createEvaluation({
    name: "검토 시험", department: "팀", contactName: "", deadline: "2030-01-01", seats: 2, requirements: "",
    slots: [{ date: "2030-01-10", start: "10:00", end: "", place: "" }], historyWeight: 50,
    followup: { enabled: true, hours: 48, onDecline: true, autoSend: false },
  });
  const vs: Evaluator[] = [];
  for (let i = 0; i < 3; i++) vs.push(await createEvaluator(evaluatorInput.parse({ name: `위원${i}`, email: `v${i}@example.com` })));
  await createInvites(e.id, vs.map((v) => v.id));
  for (const v of vs) await applyInviteAction(e.id, v.id, { type: "markSent", via: "manual" });
  const invs = await listInvites(e.id);
  const tok = (i: number) => invs.find((x) => x.evaluatorId === vs[i].id)!.token;
  const slot = e.slots[0].id;
  await submitResponse(tok(0), { attendance: "yes", slotIds: [slot], note: "" });
  await submitResponse(tok(1), { attendance: "conditional", slotIds: [slot], note: "오후만 가능" });
  return { e, vs, tok, slot };
}

describe("조건부 참석 검토", () => {
  beforeEach(() => __resetKvForTests());

  it("검토 전 조건부는 확정할 수 없고, 수락하면 확정 후보가 된다", async () => {
    const { e, vs, slot } = await setup();
    let cur = await getEvaluation(e.id);
    expect(slotSummary(cur, await listInvites(e.id))[0]).toMatchObject({ confirmable: 1, conditional: [vs[1].id], meetsSeats: false, meetsSeatsWithConditional: true });
    await expect(finalizeEvaluation(e.id, { slotId: slot, evaluatorIds: [vs[0].id, vs[1].id], memo: "", version: cur.version })).rejects.toThrow(/조건을 먼저 수락/);

    await reviewCondition(e.id, vs[1].id, "accepted", "오후 세션 배정");
    const invs = await listInvites(e.id);
    expect(inviteDisplayState(invs.find((i) => i.evaluatorId === vs[1].id)!)).toBe("cond_accepted");
    expect(slotSummary(cur, invs)[0]).toMatchObject({ confirmable: 2, accepted: [vs[1].id], meetsSeats: true });
    cur = await getEvaluation(e.id);
    const fin = await finalizeEvaluation(e.id, { slotId: slot, evaluatorIds: [vs[0].id, vs[1].id], memo: "", version: cur.version });
    expect(fin.finalization?.members.map((m) => m.attendance)).toEqual(["yes", "conditional"]);
  });

  it("거절하면 불참으로 집계되고 (불참 즉시 안내 설정 시) 다음 순위 안내 대상이 된다", async () => {
    const { e, vs } = await setup();
    await reviewCondition(e.id, vs[1].id, "rejected", "");
    const invs = await listInvites(e.id);
    expect(inviteCounts(invs)).toMatchObject({ yes: 1, conditional: 0, no: 1 });
    const plan = planFollowup(await getEvaluation(e.id), invs, new Date());
    expect(plan.triggers.map((t) => t.evaluatorId)).toEqual([vs[1].id]);
  });

  it("위원이 회신을 수정하면 검토 결과가 초기화된다", async () => {
    const { e, vs, tok, slot } = await setup();
    await reviewCondition(e.id, vs[1].id, "rejected", "");
    await submitResponse(tok(1), { attendance: "conditional", slotIds: [slot], note: "오전도 가능해졌습니다" });
    const inv = (await listInvites(e.id)).find((i) => i.evaluatorId === vs[1].id)!;
    expect(inv.conditionReview).toBeNull();
    expect(inviteDisplayState(inv)).toBe("conditional");
  });

  it("조건부가 아닌 회신은 검토 불가", async () => {
    const { e, vs } = await setup();
    await expect(reviewCondition(e.id, vs[0].id, "accepted", "")).rejects.toMatchObject({ status: 400 });
  });
});

describe("관리자 확인 요청", () => {
  beforeEach(() => __resetKvForTests());

  it("확인 요청 → 위원 답변 시 대기 해제 (직전에 문의했어도 답변은 바로 가능)", async () => {
    const { e, vs, tok } = await setup();
    await postEvaluatorMessage(tok(2), "주차 되나요?", "https://x");
    await postAdminMessage(e.id, vs[2].id, "오후 세션도 가능하신지요?", false, "https://x", { kind: "question" });
    expect(pendingQuestion(await getThread(e.id, vs[2].id))?.body).toContain("오후 세션");
    await postEvaluatorMessage(tok(2), "네 가능합니다.", "https://x");
    const t = await getThread(e.id, vs[2].id);
    expect(pendingQuestion(t)).toBeNull();
    expect(t?.unreadAdmin).toBe(1);
  });

  it("답변 요청 안내는 대상 위원마다 확인 요청으로 남는다", async () => {
    const { e, vs } = await setup();
    await createAnnouncement(e.id, { title: "식사", body: "식사 여부를 알려 주십시오.", audience: "attending", sendEmail: false, askReply: true }, "https://x");
    expect(pendingQuestion(await getThread(e.id, vs[0].id))?.body).toContain("식사");
    expect(pendingQuestion(await getThread(e.id, vs[1].id))).not.toBeNull();
    expect(await getThread(e.id, vs[2].id)).toBeNull(); // 회신 대기 위원은 대상 아님
  });
});

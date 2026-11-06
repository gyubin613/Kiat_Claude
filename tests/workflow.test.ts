import { beforeEach, describe, expect, it } from "vitest";
import { __resetKvForTests } from "@/lib/store";
import {
  applyInviteAction, createEvaluation, createEvaluator, createInvites, finalizeEvaluation, getEvaluation,
  importEvaluators, listInvites, reviewCondition, resolveToken, slotSummary, submitResponse, updateEvaluation, updateEvaluator,
} from "@/lib/repo";
import { evaluatorInput } from "@/lib/validate";
import { renderTemplate, DEFAULT_TEMPLATE } from "@/lib/email";
import { recipientAllowed } from "@/lib/mailer";

const evInput = (name: string, email = "") => evaluatorInput.parse({ name, org: "가상대", email });

async function setup() {
  const e = await createEvaluation({
    name: "시험 평가", department: "평가팀", contactName: "담당", deadline: "2030-01-01", seats: 2, requirements: "",
    slots: [
      { date: "2030-01-10", start: "10:00", end: "12:00", place: "A" },
      { date: "2030-01-11", start: "10:00", end: "12:00", place: "B" },
    ],
    historyWeight: 50,
  });
  const vs = [];
  for (let i = 0; i < 4; i++) vs.push(await createEvaluator(e.id, evInput(`위원${i}`, `v${i}@example.com`)));
  return { e, vs };
}

describe("업무 시나리오", () => {
  beforeEach(() => __resetKvForTests());

  it("중복 등록 확인 (이메일, 성명+소속)", async () => {
    const { e } = await setup();
    await createEvaluator(e.id, evInput("홍길동", "a@example.com"));
    await expect(createEvaluator(e.id, evInput("다른이름", "A@example.com "))).rejects.toThrow(/같은 이메일/);
    await expect(createEvaluator(e.id, evInput("홍길동"))).rejects.toThrow(/같은 성명·소속/);
  });

  it("개별 수정은 변경 항목만 반영하고 동시 수정은 충돌로 처리", async () => {
    const { e } = await setup();
    const v = await createEvaluator(e.id, evaluatorInput.parse({ name: "김", org: "X", phone: "010", note: "메모" }));
    const v2 = await updateEvaluator(e.id, v.id, { phone: "011" }, v.version);
    expect(v2.note).toBe("메모");
    expect(v2.phone).toBe("011");
    await expect(updateEvaluator(e.id, v.id, { note: "덮어쓰기" }, v.version)).rejects.toMatchObject({ status: 409 });
  });

  it("엑셀 등록: 빈 항목만 보완 모드", async () => {
    const { e } = await setup();
    await createEvaluator(e.id, evaluatorInput.parse({ name: "이", org: "Y", email: "lee@example.com" }));
    const res = await importEvaluators(
      e.id,
      [
        { row: 2, data: evaluatorInput.parse({ name: "이", org: "Y", email: "lee@example.com", phone: "010-9" }) },
        { row: 3, data: evInput("신규") },
      ],
      "fill",
    );
    expect(res.map((r) => r.result)).toEqual(["updated", "created"]);
  });

  it("초청 → 회신 → 집계 → 불참 시 후순위 → 확정 → 변경 제한", async () => {
    const { e, vs } = await setup();
    await createInvites(e.id, [vs[0].id, vs[1].id]);
    expect((await getEvaluation(e.id)).status).toBe("inviting");
    let invs = await listInvites(e.id);
    expect(invs).toHaveLength(2);
    expect(invs[0].round).toBe(1);

    for (const i of invs) await applyInviteAction(e.id, i.evaluatorId, { type: "markSent", via: "manual" });
    const [s1, s2] = e.slots;
    const t0 = invs.find((i) => i.evaluatorId === vs[0].id)!.token;
    const t1 = invs.find((i) => i.evaluatorId === vs[1].id)!.token;
    await submitResponse(t0, { attendance: "yes", slotIds: [s1.id, s2.id], note: "" });
    await submitResponse(t1, { attendance: "no", slotIds: [], note: "출장" });

    // 회신 수정
    const edited = await submitResponse(t0, { attendance: "conditional", slotIds: [s1.id], note: "오후만" });
    expect(edited.response?.revision).toBe(2);

    // 후순위 추가 섭외 → 2차
    await createInvites(e.id, [vs[2].id]);
    invs = await listInvites(e.id);
    const third = invs.find((i) => i.evaluatorId === vs[2].id)!;
    expect(third.round).toBe(2);
    await submitResponse(third.token, { attendance: "yes", slotIds: [s1.id], note: "" });

    const sum = slotSummary(await getEvaluation(e.id), await listInvites(e.id));
    expect(sum[0]).toMatchObject({ total: 2, meetsSeats: false, meetsSeatsWithConditional: true });
    await reviewCondition(e.id, vs[0].id, "accepted", "");
    expect(sum[1].total).toBe(0);

    // 불참자는 확정 불가
    const cur = await getEvaluation(e.id);
    await expect(finalizeEvaluation(e.id, { slotId: s1.id, evaluatorIds: [vs[1].id], memo: "", version: cur.version })).rejects.toThrow(/참석 가능으로 회신하지/);

    const fin = await finalizeEvaluation(e.id, { slotId: s1.id, evaluatorIds: [vs[0].id, vs[2].id], memo: "", version: cur.version });
    expect(fin.status).toBe("finalized");
    expect(fin.finalization?.members.map((m) => m.name)).toEqual(["위원0", "위원2"]);

    // 확정 이후 변경 제한
    await expect(updateEvaluation(e.id, { seats: 5 }, fin.version)).rejects.toMatchObject({ status: 423 });
    await expect(submitResponse(t0, { attendance: "no", slotIds: [], note: "" })).rejects.toMatchObject({ status: 423 });
    await expect(createInvites(e.id, [vs[3].id])).rejects.toMatchObject({ status: 423 });

    // 기본정보 정정은 가능하며 확정 결과(스냅샷)는 유지
    await updateEvaluator(e.id, vs[0].id, { name: "위원0-정정" }, vs[0].version);
    expect((await getEvaluation(e.id)).finalization?.members[0].name).toBe("위원0");
  });

  it("철회된 초청은 회신 불가, 회신에 쓰인 일정은 삭제 불가", async () => {
    const { e, vs } = await setup();
    await createInvites(e.id, [vs[0].id, vs[1].id]);
    const invs = await listInvites(e.id);
    await submitResponse(invs[0].token, { attendance: "yes", slotIds: [e.slots[0].id], note: "" });
    const latest = await getEvaluation(e.id);
    await expect(updateEvaluation(e.id, { slots: [{ ...e.slots[1] }] }, latest.version)).rejects.toThrow(/삭제할 수 없습니다/);

    await applyInviteAction(e.id, invs[1].evaluatorId, { type: "withdraw", reason: "테스트" });
    await expect(submitResponse(invs[1].token, { attendance: "yes", slotIds: [e.slots[0].id], note: "" })).rejects.toMatchObject({ status: 403 });
  });

  it("잘못된 링크는 404", async () => {
    await expect(resolveToken("short")).rejects.toMatchObject({ status: 404 });
    await expect(resolveToken("A".repeat(32))).rejects.toMatchObject({ status: 404 });
  });

  it("메일 양식 치환과 수신자 제한", async () => {
    const { e, vs } = await setup();
    const m = renderTemplate(DEFAULT_TEMPLATE, { evaluation: e, evaluator: vs[0], link: "https://x/r/abc" });
    expect(m.subject).toContain("시험 평가");
    expect(m.body).toContain("위원0 위원님");
    expect(m.body).toContain("https://x/r/abc");
    expect(m.body).not.toMatch(/\{\{/);
    expect(recipientAllowed("me@example.com", ["@example.com"])).toBe(true);
    expect(recipientAllowed("me@other.com", ["@example.com"])).toBe(false);
    expect(recipientAllowed("me@other.com", [])).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { __resetKvForTests } from "@/lib/store";
import { applyInviteAction, createEvaluation, createEvaluator, createInvites, getEvaluation, listInvites, submitResponse } from "@/lib/repo";
import { createAnnouncement, getThread, listAnnouncements, listThreads, markReadByAdmin, postAdminMessage, postEvaluatorMessage } from "@/lib/comm";
import { evaluatorInput } from "@/lib/validate";

async function setup() {
  const e = await createEvaluation({
    name: "소통 시험", department: "팀", contactName: "홍", deadline: "2030-01-01", seats: 2, requirements: "",
    slots: [{ date: "2030-01-10", start: "10:00", end: "", place: "" }], historyWeight: 50,
  });
  const a = await createEvaluator(evaluatorInput.parse({ name: "가위원", email: "a@example.com" }));
  const b = await createEvaluator(evaluatorInput.parse({ name: "나위원", email: "b@example.com" }));
  await createInvites(e.id, [a.id, b.id]);
  const invs = await listInvites(e.id);
  return { e, a, b, ta: invs.find((i) => i.evaluatorId === a.id)!.token, tb: invs.find((i) => i.evaluatorId === b.id)!.token };
}

describe("위원 소통", () => {
  beforeEach(() => __resetKvForTests());

  it("위원 문의 → 관리자 미확인 → 답변 시 확인 처리, 메일은 서비스 미설정이면 미발송으로 기록", async () => {
    const { e, a, ta } = await setup();
    await postEvaluatorMessage(ta, "주차 되나요?", "https://x");
    expect((await listThreads(e.id))[0].unreadAdmin).toBe(1);
    const r = await postAdminMessage(e.id, a.id, "가능합니다.", true, "https://x");
    expect(r.email).toMatchObject({ status: "skipped" });
    expect(r.link).toBe(`https://x/r/${ta}`);
    const t = await getThread(e.id, a.id);
    expect(t?.unreadAdmin).toBe(0);
    expect(t?.unreadEvaluator).toBe(1);
    expect(t?.messages.map((m) => m.from)).toEqual(["evaluator", "admin"]);
  });

  it("연속 문의는 잠시 제한, 철회된 위원은 문의 불가", async () => {
    const { e, b, ta, tb } = await setup();
    await postEvaluatorMessage(ta, "1", "https://x");
    await expect(postEvaluatorMessage(ta, "2", "https://x")).rejects.toMatchObject({ status: 429 });
    await applyInviteAction(e.id, b.id, { type: "withdraw", reason: "" });
    await expect(postEvaluatorMessage(tb, "문의", "https://x")).rejects.toMatchObject({ status: 403 });
  });

  it("관리자 읽음 처리", async () => {
    const { e, a, ta } = await setup();
    await postEvaluatorMessage(ta, "질문", "https://x");
    await markReadByAdmin(e.id, a.id);
    expect((await getThread(e.id, a.id))?.unreadAdmin).toBe(0);
  });

  it("안내사항은 대상 위원에게만 게시", async () => {
    const { e, a, b, ta } = await setup();
    await submitResponse(ta, { attendance: "yes", slotIds: [(await getEvaluation(e.id)).slots[0].id], note: "" });
    const r = await createAnnouncement(e.id, { title: "자료", body: "송부", audience: "attending", sendEmail: false }, "https://x");
    expect(r.announcement.recipientIds).toEqual([a.id]);
    const w = await createAnnouncement(e.id, { title: "독촉", body: "회신 부탁", audience: "waiting", sendEmail: true }, "https://x");
    expect(w.announcement.recipientIds).toEqual([b.id]);
    expect(w.announcement.result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(w.failures[0]).toMatchObject({ name: "나위원" });
    expect(await listAnnouncements(e.id)).toHaveLength(2);
  });
});

describe("위원 회신 화면 API", () => {
  beforeEach(() => __resetKvForTests());
  it("새 답변 수를 보여준 뒤 읽음 처리하고, 다른 위원의 대화는 노출하지 않는다", async () => {
    const { e, a, ta, tb } = await setup();
    await postEvaluatorMessage(ta, "질문", "https://x");
    await postAdminMessage(e.id, a.id, "답변", false, "https://x");
    const { GET } = await import("@/app/api/respond/[token]/route");
    const call = async (t: string) => (await GET(new Request(`https://x/api/respond/${t}`), { params: Promise.resolve({ token: t }) })).json();
    const first = await call(ta);
    expect(first.unread).toBe(1);
    expect(first.messages.map((m: { body: string }) => m.body)).toEqual(["질문", "답변"]);
    expect(first.messages[1]).not.toHaveProperty("email");
    expect((await call(ta)).unread).toBe(0);
    expect((await call(tb)).messages).toEqual([]);
  });
});

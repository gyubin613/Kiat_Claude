import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKvForTests } from "@/lib/store";
import { applyInviteAction, createEvaluation, createEvaluator, getEvaluation, listInvites, reviewCondition, setAutoRunning, submitResponse, updateEvaluation } from "@/lib/repo";
import { runFollowupFor } from "@/lib/followup";
import { evaluatorInput } from "@/lib/validate";
import type { Evaluator } from "@/lib/types";

const H = 3600 * 1000;
let sent: string[] = [];

async function setup(seats = 2) {
  const e = await createEvaluation({
    name: "자동 섭외", department: "팀", contactName: "", deadline: "2030-01-01", seats, requirements: "",
    slots: [{ date: "2030-01-10", start: "10:00", end: "", place: "" }], historyWeight: 50, recruitMode: "auto",
    followup: { enabled: false, hours: 24, onDecline: false, autoSend: false }, // 자동 섭외는 이 값과 무관하게 동작해야 함
  });
  const vs: Evaluator[] = [];
  // 점수순: 위원0 > 위원1 > ... (선호도 5,4,3,2,1)
  for (let i = 0; i < 5; i++) vs.push(await createEvaluator(e.id, evaluatorInput.parse({ name: `위원${i}`, email: `v${i}@example.com`, preference: 5 - i })));
  return { e: await getEvaluation(e.id), vs };
}

const route = async (token: string, body: unknown) => {
  const { POST } = await import("@/app/api/respond/[token]/route");
  return POST(new Request(`https://app/api/respond/${token}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });
};
const tokenOf = async (evalId: string, evaluatorId: string) => (await listInvites(evalId)).find((i) => i.evaluatorId === evaluatorId)!.token;

describe("자동 섭외", () => {
  beforeEach(() => {
    __resetKvForTests();
    sent = [];
    process.env.RESEND_API_KEY = "k";
    process.env.EMAIL_FROM = "noreply@example.com";
    process.env.EMAIL_ALLOWED_RECIPIENTS = "@example.com";
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).to[0]);
      return new Response(JSON.stringify({ id: "m" }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_ALLOWED_RECIPIENTS"]) delete process.env[k];
  });

  it("시작 전에는 보내지 않고, 시작하면 끌어서 정한 순서대로 배석 인원만큼 바로 발송 (제외 위원 건너뜀)", async () => {
    const { e, vs } = await setup(2);
    expect(await runFollowupFor(e.id, "https://app")).toBeNull();
    expect(sent).toEqual([]);
    // 담당자가 순서를 위원3, 위원0, 위원1 로 바꾸고 위원0은 제외
    await setAutoRunning(e.id, true, { queue: [vs[3].id, vs[0].id, vs[1].id], excluded: [vs[0].id] });
    const r = await runFollowupFor(e.id, "https://app");
    expect(r?.invited.map((i) => i.name)).toEqual(["위원3", "위원1"]);
    expect(sent).toEqual(["v3@example.com", "v1@example.com"]);
    const invs = await listInvites(e.id);
    expect(invs.every((i) => i.status === "sent" && i.sentVia === "email")).toBe(true);
    // 다시 실행해도 인원이 차 있으면 더 보내지 않음
    expect(await runFollowupFor(e.id, "https://app")).toBeNull();
  });

  it("불참 회신이 오면 그 즉시 다음 순서 위원에게 발송", async () => {
    const { e, vs } = await setup(2);
    await setAutoRunning(e.id, true, { queue: vs.map((v) => v.id) });
    await runFollowupFor(e.id, "https://app");
    sent = [];
    const res = await route(await tokenOf(e.id, vs[0].id), { attendance: "no", slotIds: [], note: "출장" });
    expect(res.status).toBe(200);
    expect(sent).toEqual(["v2@example.com"]);
    const v0 = (await listInvites(e.id)).find((i) => i.evaluatorId === vs[0].id)!;
    expect(v0.escalatedAt).toBeTruthy();
    // 참석 회신은 다음 위원을 부르지 않음
    sent = [];
    await route(await tokenOf(e.id, vs[1].id), { attendance: "yes", slotIds: [e.slots[0].id], note: "" });
    expect(sent).toEqual([]);
  });

  it("조건부 거절·섭외 철회도 바로 다음 순서로 넘어간다", async () => {
    const { e, vs } = await setup(2);
    await setAutoRunning(e.id, true, { queue: vs.map((v) => v.id) });
    await runFollowupFor(e.id, "https://app");
    sent = [];
    await submitResponse(await tokenOf(e.id, vs[0].id), { attendance: "conditional", slotIds: [e.slots[0].id], note: "오전만" });
    await reviewCondition(e.id, vs[0].id, "rejected", "");
    await runFollowupFor(e.id, "https://app");
    expect(sent).toEqual(["v2@example.com"]);
    sent = [];
    await applyInviteAction(e.id, vs[1].id, { type: "withdraw", reason: "" });
    await runFollowupFor(e.id, "https://app");
    expect(sent).toEqual(["v3@example.com"]);
  });

  it("무응답 기간이 지나면 다음 순서로, 중지하면 더 보내지 않음", async () => {
    const { e, vs } = await setup(1);
    await setAutoRunning(e.id, true, { queue: vs.map((v) => v.id) });
    await runFollowupFor(e.id, "https://app");
    sent = [];
    await runFollowupFor(e.id, "https://app", new Date(Date.now() + 25 * H));
    expect(sent).toEqual(["v1@example.com"]);
    await setAutoRunning(e.id, false);
    sent = [];
    await route(await tokenOf(e.id, vs[1].id), { attendance: "no", slotIds: [], note: "" });
    expect(sent).toEqual([]);
  });

  it("동시에 여러 번 실행돼도 한 번만 보낸다", async () => {
    const { e, vs } = await setup(2);
    await setAutoRunning(e.id, true, { queue: vs.map((v) => v.id) });
    await Promise.all([runFollowupFor(e.id, "https://app"), runFollowupFor(e.id, "https://app"), runFollowupFor(e.id, "https://app")]);
    expect(sent.sort()).toEqual(["v0@example.com", "v1@example.com"]);
    expect(await listInvites(e.id)).toHaveLength(2);
  });

  it("수동 섭외 평가에서는 자동 섭외를 시작할 수 없다", async () => {
    const { e } = await setup(1);
    const manual = await updateEvaluation(e.id, { recruitMode: "manual" }, e.version);
    await expect(setAutoRunning(manual.id, true)).rejects.toMatchObject({ status: 400 });
  });
});

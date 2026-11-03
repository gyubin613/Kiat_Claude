import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetKvForTests } from "@/lib/store";
import { applyInviteAction, createEvaluation, createEvaluator, createInvites, getEvaluation, listInvites, submitResponse, updateEvaluation } from "@/lib/repo";
import { planFollowup, runFollowupFor } from "@/lib/followup";
import { evaluatorInput } from "@/lib/validate";

const H = 3600 * 1000;

async function setup(opts: { onDecline?: boolean; seats?: number } = {}) {
  const e = await createEvaluation({
    name: "후속 시험", department: "팀", contactName: "", deadline: "2030-01-01", seats: opts.seats ?? 2, requirements: "",
    slots: [{ date: "2030-01-10", start: "10:00", end: "", place: "" }],
    historyWeight: 50,
    followup: { enabled: true, hours: 48, onDecline: opts.onDecline ?? false, autoSend: true },
  });
  const vs = [];
  // 선호도가 높은 순서대로 v0 > v1 > ... (우선순위 순서 고정)
  for (let i = 0; i < 6; i++)
    vs.push(await createEvaluator(evaluatorInput.parse({ name: `위원${i}`, org: "가상", email: `v${i}@example.com`, preference: 5 - Math.min(i, 4) })));
  await createInvites(e.id, [vs[0].id, vs[1].id]);
  for (const v of [vs[0], vs[1]]) await applyInviteAction(e.id, v.id, { type: "markSent", via: "manual" });
  return { e: await getEvaluation(e.id), vs };
}

describe("무응답 자동 후속 안내", () => {
  beforeEach(() => __resetKvForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_ALLOWED_RECIPIENTS;
  });

  it("기간 전에는 아무것도 하지 않는다", async () => {
    const { e } = await setup();
    expect(await runFollowupFor(e.id, "https://x", new Date(Date.now() + 47 * H))).toBeNull();
  });

  it("기간이 지나면 무응답 인원만큼 다음 순위를 초청하고 중복 실행해도 한 번만 처리", async () => {
    const { e, vs } = await setup();
    const t0 = (await listInvites(e.id)).find((i) => i.evaluatorId === vs[0].id)!.token;
    await submitResponse(t0, { attendance: "yes", slotIds: [e.slots[0].id], note: "" });
    const later = new Date(Date.now() + 49 * H);
    const r = await runFollowupFor(e.id, "https://x", later);
    expect(r?.triggered).toBe(1);
    expect(r?.invited.map((i) => i.name)).toEqual(["위원2"]);
    expect(r?.invited[0].sent).toBe(false); // 발송 서비스 미설정 → 초청만 추가

    const invs = await listInvites(e.id);
    const added = invs.find((i) => i.evaluatorId === vs[2].id)!;
    expect(added).toMatchObject({ status: "pending", autoInvited: true, round: 2 });
    expect(invs.find((i) => i.evaluatorId === vs[1].id)!.escalatedAt).toBeTruthy();
    expect(invs.find((i) => i.evaluatorId === vs[1].id)!.status).toBe("sent"); // 기존 위원 초청은 유지

    expect(await runFollowupFor(e.id, "https://x", later)).toBeNull();
    expect(await listInvites(e.id)).toHaveLength(3);
  });

  it("필요 인원이 이미 확보되면 추가 초청하지 않는다", async () => {
    const { e, vs } = await setup({ seats: 1 });
    const t0 = (await listInvites(e.id)).find((i) => i.evaluatorId === vs[0].id)!.token;
    await submitResponse(t0, { attendance: "yes", slotIds: [e.slots[0].id], note: "" });
    const r = await runFollowupFor(e.id, "https://x", new Date(Date.now() + 49 * H));
    expect(r?.invited).toHaveLength(0);
    expect(r?.note).toMatch(/필요 인원이 확보/);
  });

  it("불참 즉시 안내 옵션", async () => {
    const { e, vs } = await setup({ onDecline: true });
    const invs = await listInvites(e.id);
    await submitResponse(invs.find((i) => i.evaluatorId === vs[0].id)!.token, { attendance: "no", slotIds: [], note: "" });
    const plan = planFollowup(await getEvaluation(e.id), await listInvites(e.id), new Date());
    expect(plan.triggers).toHaveLength(1);
    const r = await runFollowupFor(e.id, "https://x");
    expect(r?.invited.map((i) => i.name)).toEqual(["위원2"]);
  });

  it("꺼져 있거나 확정된 평가는 처리하지 않는다", async () => {
    const { e } = await setup();
    await updateEvaluation(e.id, { followup: { enabled: false, hours: 48, onDecline: false, autoSend: true } }, e.version);
    expect(await runFollowupFor(e.id, "https://x", new Date(Date.now() + 100 * H))).toBeNull();
  });

  it("발송 서비스·허용목록이 설정되면 자동으로 메일을 보내고 발송 상태로 표시", async () => {
    process.env.RESEND_API_KEY = "k";
    process.env.EMAIL_FROM = "noreply@example.com";
    process.env.EMAIL_ALLOWED_RECIPIENTS = "@example.com";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "mail_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { e, vs } = await setup();
    const r = await runFollowupFor(e.id, "https://app.example", new Date(Date.now() + 49 * H));
    expect(r?.invited.map((i) => i.sent)).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toEqual(["v2@example.com"]);
    expect(body.text).toContain("https://app.example/r/");
    const added = (await listInvites(e.id)).find((i) => i.evaluatorId === vs[2].id)!;
    expect(added).toMatchObject({ status: "sent", sentVia: "email" });
  });
});

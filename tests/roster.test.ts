import { beforeEach, describe, expect, it } from "vitest";
import { __resetKvForTests, kv } from "@/lib/store";
import {
  applyInviteAction, copyEvaluators, createEvaluation, createEvaluator, createInvites, deleteEvaluator, deleteEvaluation,
  finalizeEvaluation, getEvaluation, importEvaluators, K, listEvaluators, listInvites, submitResponse, updateEvaluator,
} from "@/lib/repo";
import { buildRosterWorkbook, parseEvaluatorWorkbook } from "@/lib/excel";
import { evaluatorInput } from "@/lib/validate";
import { nowIso } from "@/lib/util";

const ev = (name: string, email: string, extra: Record<string, unknown> = {}) => evaluatorInput.parse({ name, org: "가상", email, ...extra });
const newEval = (name: string) =>
  createEvaluation({
    name, department: "", contactName: "", deadline: "2030-01-01", seats: 1, requirements: "",
    slots: [{ date: "2030-01-10", start: "10:00", end: "", place: "" }], historyWeight: 50,
  });

describe("평가별 평가위원 명단", () => {
  beforeEach(() => __resetKvForTests());

  it("새 평가는 빈 명단으로 시작하고 평가마다 따로 관리된다", async () => {
    const a = await newEval("A");
    await createEvaluator(a.id, ev("가", "ga@example.com"));
    const b = await newEval("B");
    expect(await listEvaluators(b.id)).toEqual([]);
    expect(await listEvaluators(a.id)).toHaveLength(1);
    // 같은 사람을 다른 평가에 등록해도 중복이 아님
    await createEvaluator(b.id, ev("가", "ga@example.com"));
    expect(await listEvaluators(b.id)).toHaveLength(1);
  });

  it("다른 평가 명단의 위원은 초청할 수 없다", async () => {
    const a = await newEval("A");
    const b = await newEval("B");
    const v = await createEvaluator(a.id, ev("가", "ga@example.com"));
    await expect(createInvites(b.id, [v.id])).rejects.toMatchObject({ status: 404 });
  });

  it("이전 평가에서 일괄·선택 불러오기, 이미 있는 위원은 건너뜀, 복사본은 독립적", async () => {
    const a = await newEval("A");
    const v1 = await createEvaluator(a.id, ev("가", "ga@example.com"));
    const v2 = await createEvaluator(a.id, ev("나", "na@example.com"));
    await createEvaluator(a.id, ev("다", "da@example.com"));
    const b = await newEval("B");
    const sel = await copyEvaluators(b.id, a.id, [v1.id, v2.id]);
    expect(sel.map((r) => r.result)).toEqual(["created", "created"]);
    const all = await copyEvaluators(b.id, a.id, null);
    expect(all.filter((r) => r.result === "created").map((r) => r.name)).toEqual(["다"]);
    expect(all.filter((r) => r.result === "skipped")).toHaveLength(2);
    const copies = await listEvaluators(b.id);
    expect(copies.map((c) => c.name)).toEqual(["가", "나", "다"]);
    expect(copies.every((c) => c.evaluationId === b.id && ![v1.id, v2.id].includes(c.id))).toBe(true);
    // 복사본을 수정해도 원본은 그대로
    const c1 = copies.find((c) => c.name === "가")!;
    await updateEvaluator(b.id, c1.id, { phone: "010-1" }, c1.version);
    expect((await listEvaluators(a.id)).find((x) => x.name === "가")!.phone).toBe("");
  });

  it("불러오기 시 이전 평가 결과를 과거 초청·참여 이력에 반영", async () => {
    const a = await newEval("A");
    const yes = await createEvaluator(a.id, ev("참석", "y@example.com", { pastInvited: 2, pastAttended: 1 }));
    const no = await createEvaluator(a.id, ev("불참", "n@example.com"));
    await createEvaluator(a.id, ev("미초청", "i@example.com", { pastInvited: 1, pastAttended: 0 }));
    await createInvites(a.id, [yes.id, no.id]);
    for (const v of [yes, no]) await applyInviteAction(a.id, v.id, { type: "markSent", via: "manual" });
    const invs = await listInvites(a.id);
    const slot = (await getEvaluation(a.id)).slots[0].id;
    await submitResponse(invs.find((i) => i.evaluatorId === yes.id)!.token, { attendance: "yes", slotIds: [slot], note: "" });
    await submitResponse(invs.find((i) => i.evaluatorId === no.id)!.token, { attendance: "no", slotIds: [], note: "" });
    await finalizeEvaluation(a.id, { slotId: slot, evaluatorIds: [yes.id], memo: "", version: (await getEvaluation(a.id)).version });

    const b = await newEval("B");
    await copyEvaluators(b.id, a.id, null, { applyHistory: true });
    const byName = Object.fromEntries((await listEvaluators(b.id)).map((v) => [v.name, v]));
    expect([byName["참석"].pastInvited, byName["참석"].pastAttended]).toEqual([3, 2]);
    expect([byName["불참"].pastInvited, byName["불참"].pastAttended]).toEqual([1, 0]);
    expect([byName["미초청"].pastInvited, byName["미초청"].pastAttended]).toEqual([1, 0]);
  });

  it("이전 버전 공통 명단은 기존 평가에 자동 연결되고 새 평가는 불러오기 원본으로 쓸 수 있다", async () => {
    const a = await newEval("기존 평가");
    const store = kv();
    // 평가별 명단 도입 전 상태를 재현
    await store.del(K.rosterInit(a.id));
    const legacy = { id: "v_legacy1", ...ev("공통", "legacy@example.com"), ...{ bachelorSchool: "" }, createdAt: nowIso(), updatedAt: nowIso(), version: 1 };
    await store.set(K.evaluator(legacy.id), legacy);
    await store.sadd(K.evaluators, legacy.id);
    expect((await listEvaluators(a.id)).map((v) => v.name)).toEqual(["공통"]);
    const b = await newEval("새 평가");
    expect(await listEvaluators(b.id)).toEqual([]);
    await copyEvaluators(b.id, "legacy", null);
    expect((await listEvaluators(b.id)).map((v) => v.name)).toEqual(["공통"]);
  });

  it("명단에서 빼기: 초청한 위원은 불가, 평가 삭제 시 그 평가 명단도 정리", async () => {
    const a = await newEval("A");
    const v = await createEvaluator(a.id, ev("가", "ga@example.com"));
    const w = await createEvaluator(a.id, ev("나", "na@example.com"));
    await createInvites(a.id, [v.id]);
    await expect(deleteEvaluator(a.id, v.id)).rejects.toMatchObject({ status: 400 });
    await deleteEvaluator(a.id, w.id);
    expect((await listEvaluators(a.id)).map((x) => x.name)).toEqual(["가"]);
    expect(await kv().get(K.evaluator(w.id))).toBeNull();
    await deleteEvaluation(a.id);
    expect(await kv().get(K.evaluator(v.id))).toBeNull();
  });

  it("명단 엑셀을 내려받아 고친 뒤 다른 평가에 다시 올릴 수 있다", async () => {
    const a = await newEval("A");
    await createEvaluator(a.id, ev("가", "ga@example.com", { finalDegree: "박사", finalSchool: "MIT", finalAbroad: "Y", overseasWorkYears: 2 }));
    const buf = await buildRosterWorkbook(await listEvaluators(a.id));
    const { rows, unmatchedHeaders } = await parseEvaluatorWorkbook(new Uint8Array(buf).buffer);
    expect(unmatchedHeaders).toEqual([]);
    const b = await newEval("B");
    await importEvaluators(b.id, rows.map((r) => ({ row: r.row, data: r.data! })), "skip");
    expect((await listEvaluators(b.id))[0]).toMatchObject({ name: "가", finalSchool: "MIT", finalAbroad: true, overseasWorkYears: 2 });
  });
});

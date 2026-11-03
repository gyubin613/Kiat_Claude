import { kv } from "./store";
import type { Attendance, Evaluation, Evaluator, Invite, Slot } from "./types";
import { DEFAULT_TEMPLATE } from "./email";
import { newId, newToken, normalizeEmail, normalizeKey, nowIso } from "./util";
import type { z } from "zod";
import type { evaluationInput, evaluatorInput, responseInput } from "./validate";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const K = {
  evals: "evaluations",
  eval: (id: string) => `evaluation:${id}`,
  evaluators: "evaluators",
  evaluator: (id: string) => `evaluator:${id}`,
  invites: (evalId: string) => `invites:${evalId}`,
  invite: (evalId: string, evaluatorId: string) => `invite:${evalId}:${evaluatorId}`,
  token: (t: string) => `token:${t}`,
  evaluatorInvites: (evaluatorId: string) => `evaluatorInvites:${evaluatorId}`,
};

type Versioned = { version: number; updatedAt: string };

/** 클라이언트가 보유한 버전 기준 갱신 — 다른 사용자가 먼저 수정했다면 409 */
async function updateWithVersion<T extends Versioned>(key: string, expected: number, mutate: (cur: T) => T, label: string) {
  const store = kv();
  const cur = await store.get<T>(key);
  if (!cur) throw new AppError(404, `${label} 정보를 찾을 수 없습니다.`);
  if (cur.version !== expected)
    throw new AppError(409, "다른 사용자가 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.", { current: cur });
  const next = { ...mutate(cur), version: cur.version + 1, updatedAt: nowIso() };
  const res = await store.cas(key, expected, next);
  if (res === "conflict") {
    const latest = await store.get<T>(key);
    throw new AppError(409, "다른 사용자가 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.", { current: latest });
  }
  if (res === "missing") throw new AppError(404, `${label} 정보를 찾을 수 없습니다.`);
  return next;
}

/** 서버 내부 갱신 — 충돌 시 최신 값으로 재시도 */
async function updateWithRetry<T extends Versioned>(key: string, mutate: (cur: T) => T, label: string) {
  const store = kv();
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await store.get<T>(key);
    if (!cur) throw new AppError(404, `${label} 정보를 찾을 수 없습니다.`);
    const next = { ...mutate(cur), version: cur.version + 1, updatedAt: nowIso() };
    const res = await store.cas(key, cur.version, next);
    if (res === "ok") return next;
    if (res === "missing") throw new AppError(404, `${label} 정보를 찾을 수 없습니다.`);
    await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
  }
  throw new AppError(409, "동시에 요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

const pushLog = (inv: Invite, action: string): Invite["log"] => [{ at: nowIso(), action }, ...(inv.log ?? [])].slice(0, 30);

// ======================= 평가 =======================

type EvaluationInput = z.output<typeof evaluationInput>;

function normalizeSlots(slots: EvaluationInput["slots"], prev: Slot[] = []): Slot[] {
  const prevIds = new Set(prev.map((s) => s.id));
  return slots
    .map((s) => ({
      id: s.id && prevIds.has(s.id) ? s.id : newId("s_"),
      date: s.date,
      start: s.start,
      end: s.end ?? "",
      place: s.place ?? "",
    }))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export async function listEvaluations(): Promise<Evaluation[]> {
  const store = kv();
  const ids = await store.smembers(K.evals);
  const items = (await store.mget<Evaluation>(ids.map(K.eval))).filter(Boolean) as Evaluation[];
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getEvaluation(id: string) {
  const e = await kv().get<Evaluation>(K.eval(id));
  if (!e) throw new AppError(404, "평가 정보를 찾을 수 없습니다.");
  return e;
}

export async function createEvaluation(input: EvaluationInput): Promise<Evaluation> {
  const now = nowIso();
  const e: Evaluation = {
    id: newId("e_"),
    name: input.name,
    department: input.department,
    contactName: input.contactName,
    deadline: input.deadline,
    seats: input.seats,
    requirements: input.requirements,
    slots: normalizeSlots(input.slots),
    historyWeight: input.historyWeight,
    emailTemplate: input.emailTemplate ?? DEFAULT_TEMPLATE,
    status: "draft",
    finalization: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await kv().set(K.eval(e.id), e);
  await kv().sadd(K.evals, e.id);
  return e;
}

export async function updateEvaluation(id: string, patch: Partial<EvaluationInput>, version: number) {
  // 회신에서 선택된 후보 일정이 삭제되는지 확인
  if (patch.slots) {
    const cur = await getEvaluation(id);
    const keep = new Set(patch.slots.map((s) => s.id).filter(Boolean));
    const removed = cur.slots.filter((s) => !keep.has(s.id));
    if (removed.length) {
      const invites = await listInvites(id);
      const used = removed.filter((s) => invites.some((inv) => inv.response?.slotIds.includes(s.id)));
      if (used.length)
        throw new AppError(
          400,
          `이미 평가위원이 선택한 후보 일정은 삭제할 수 없습니다. (${used.map((s) => `${s.date} ${s.start}`).join(", ")})`,
        );
    }
  }
  return updateWithVersion<Evaluation>(
    K.eval(id),
    version,
    (cur) => {
      if (cur.status === "finalized") {
        // 확정 이후에는 결과 보호: 평가 정보 변경 불가
        throw new AppError(423, "최종 확정된 평가는 수정할 수 없습니다.");
      }
      return {
        ...cur,
        ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "slots")),
        slots: patch.slots ? normalizeSlots(patch.slots, cur.slots) : cur.slots,
      };
    },
    "평가",
  );
}

export async function deleteEvaluation(id: string) {
  const store = kv();
  const invites = await listInvites(id);
  await store.del(
    K.eval(id),
    K.invites(id),
    ...invites.map((i) => K.invite(id, i.evaluatorId)),
    ...invites.map((i) => K.token(i.token)),
  );
  for (const i of invites) await store.srem(K.evaluatorInvites(i.evaluatorId), id);
  await store.srem(K.evals, id);
}

// ======================= 평가위원 =======================

type EvaluatorInput = z.output<typeof evaluatorInput>;

export async function listEvaluators(): Promise<Evaluator[]> {
  const store = kv();
  const ids = await store.smembers(K.evaluators);
  const items = (await store.mget<Evaluator>(ids.map(K.evaluator))).filter(Boolean) as Evaluator[];
  return items.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function getEvaluator(id: string) {
  const v = await kv().get<Evaluator>(K.evaluator(id));
  if (!v) throw new AppError(404, "평가위원 정보를 찾을 수 없습니다.");
  return v;
}

type DupTarget = Pick<Evaluator, "id" | "name" | "org" | "email">;
export type DuplicateMatch<T extends DupTarget = Evaluator> = { by: "email" | "nameOrg"; evaluator: T };

export function findDuplicate<T extends DupTarget>(
  cand: { name: string; org: string; email: string },
  all: T[],
  excludeId?: string,
): DuplicateMatch<T> | null {
  const email = normalizeEmail(cand.email);
  if (email) {
    const hit = all.find((v) => v.id !== excludeId && v.email && normalizeEmail(v.email) === email);
    if (hit) return { by: "email", evaluator: hit };
  }
  const key = normalizeKey(cand.name) + "|" + normalizeKey(cand.org);
  if (cand.name && cand.org) {
    const hit = all.find((v) => v.id !== excludeId && normalizeKey(v.name) + "|" + normalizeKey(v.org) === key);
    if (hit) return { by: "nameOrg", evaluator: hit };
  }
  return null;
}

export async function createEvaluator(input: EvaluatorInput, opts: { allowDuplicate?: boolean } = {}) {
  const all = await listEvaluators();
  const dup = findDuplicate(input, all);
  if (dup && !opts.allowDuplicate) {
    throw new AppError(
      409,
      dup.by === "email"
        ? `같은 이메일로 등록된 평가위원이 있습니다: ${dup.evaluator.name}(${dup.evaluator.org || "소속 미입력"})`
        : `같은 성명·소속기관의 평가위원이 있습니다: ${dup.evaluator.name}(${dup.evaluator.org})`,
      { duplicate: dup.evaluator, by: dup.by },
    );
  }
  const now = nowIso();
  const v: Evaluator = { id: newId("v_"), ...input, createdAt: now, updatedAt: now, version: 1 };
  await kv().set(K.evaluator(v.id), v);
  await kv().sadd(K.evaluators, v.id);
  return v;
}

export async function updateEvaluator(id: string, patch: Partial<EvaluatorInput>, version: number) {
  if (patch.email !== undefined || patch.name !== undefined || patch.org !== undefined) {
    const cur = await getEvaluator(id);
    const merged = { name: patch.name ?? cur.name, org: patch.org ?? cur.org, email: patch.email ?? cur.email };
    const dup = findDuplicate(merged, await listEvaluators(), id);
    if (dup?.by === "email")
      throw new AppError(409, `같은 이메일로 등록된 평가위원이 있습니다: ${dup.evaluator.name}`, { duplicate: dup.evaluator });
  }
  return updateWithVersion<Evaluator>(
    K.evaluator(id),
    version,
    (cur) => {
      const next = { ...cur, ...patch };
      if (next.pastInvited != null && next.pastAttended != null && next.pastAttended > next.pastInvited)
        throw new AppError(400, "참여 횟수는 초청 횟수보다 클 수 없습니다.");
      return next;
    },
    "평가위원",
  );
}

export async function deleteEvaluator(id: string) {
  const store = kv();
  const evalIds = await store.smembers(K.evaluatorInvites(id));
  if (evalIds.length) {
    const evals = (await store.mget<Evaluation>(evalIds.map(K.eval))).filter(Boolean) as Evaluation[];
    throw new AppError(
      400,
      `초청 이력이 있는 평가위원은 삭제할 수 없습니다. (${evals.map((e) => e.name).join(", ")})`,
    );
  }
  await store.del(K.evaluator(id));
  await store.srem(K.evaluators, id);
}

export type ImportMode = "skip" | "fill" | "overwrite";
export type ImportRowResult = {
  row: number;
  name: string;
  result: "created" | "updated" | "skipped" | "error";
  message?: string;
};

/** 엑셀 일괄 등록. 중복 시 건너뛰기 / 빈 항목만 보완 / 덮어쓰기 */
export async function importEvaluators(
  rows: { row: number; data: EvaluatorInput }[],
  mode: ImportMode,
): Promise<ImportRowResult[]> {
  const all = await listEvaluators();
  const results: ImportRowResult[] = [];
  for (const { row, data } of rows) {
    const dup = findDuplicate(data, all);
    if (!dup) {
      const v = await createEvaluator(data, { allowDuplicate: true });
      all.push(v);
      results.push({ row, name: data.name, result: "created" });
      continue;
    }
    if (mode === "skip") {
      results.push({ row, name: data.name, result: "skipped", message: dup.by === "email" ? "이메일 중복" : "성명·소속 중복" });
      continue;
    }
    const cur = dup.evaluator;
    const patch: Partial<EvaluatorInput> = {};
    for (const [key, val] of Object.entries(data) as [keyof EvaluatorInput, unknown][]) {
      const empty = val === null || val === "" || val === undefined;
      if (empty) continue;
      const curVal = cur[key];
      const curEmpty = curVal === null || curVal === "" || curVal === undefined;
      if (mode === "overwrite" || curEmpty) (patch as Record<string, unknown>)[key] = val;
    }
    if (Object.keys(patch).length === 0) {
      results.push({ row, name: data.name, result: "skipped", message: "변경할 항목 없음" });
      continue;
    }
    try {
      const next = await updateEvaluator(cur.id, patch, cur.version);
      all.splice(all.indexOf(cur), 1, next);
      results.push({ row, name: data.name, result: "updated", message: `${Object.keys(patch).length}개 항목 반영` });
    } catch (e) {
      results.push({ row, name: data.name, result: "error", message: e instanceof Error ? e.message : "오류" });
    }
  }
  return results;
}

// ======================= 초청·회신 =======================

export async function listInvites(evalId: string): Promise<Invite[]> {
  const store = kv();
  const ids = await store.smembers(K.invites(evalId));
  const items = (await store.mget<Invite>(ids.map((v) => K.invite(evalId, v)))).filter(Boolean) as Invite[];
  return items.sort((a, b) => a.round - b.round || a.createdAt.localeCompare(b.createdAt));
}

function assertNotFinalized(e: Evaluation) {
  if (e.status === "finalized") throw new AppError(423, "최종 확정된 평가는 초청 정보를 변경할 수 없습니다.");
}

export async function createInvites(evalId: string, evaluatorIds: string[]) {
  const store = kv();
  const evaluation = await getEvaluation(evalId);
  assertNotFinalized(evaluation);
  const existing = await listInvites(evalId);
  const round = existing.length ? Math.max(...existing.map((i) => i.round)) + (existing.some((i) => i.status !== "pending") ? 1 : 0) : 1;
  const created: Invite[] = [];
  for (const evaluatorId of [...new Set(evaluatorIds)]) {
    if (existing.some((i) => i.evaluatorId === evaluatorId)) continue;
    await getEvaluator(evaluatorId);
    const now = nowIso();
    const inv: Invite = {
      evaluationId: evalId,
      evaluatorId,
      token: newToken(),
      status: "pending",
      round,
      sentAt: null,
      sentVia: null,
      withdrawnReason: "",
      response: null,
      log: [{ at: now, action: `${round}차 초청 대상으로 선정` }],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    // 동시에 같은 위원이 추가되는 경우 하나만 생성
    if (!(await store.setnx(K.invite(evalId, evaluatorId), inv))) continue;
    await store.set(K.token(inv.token), { evalId, evaluatorId });
    await store.sadd(K.invites(evalId), evaluatorId);
    await store.sadd(K.evaluatorInvites(evaluatorId), evalId);
    created.push(inv);
  }
  if (created.length && evaluation.status === "draft") {
    await updateWithRetry<Evaluation>(K.eval(evalId), (cur) => ({ ...cur, status: cur.status === "draft" ? "inviting" : cur.status }), "평가");
  }
  return created;
}

export type InviteAction =
  | { type: "markSent"; via: "manual" | "email"; detail?: string }
  | { type: "unmarkSent" }
  | { type: "withdraw"; reason: string }
  | { type: "reinvite" }
  | { type: "remove" };

export async function applyInviteAction(evalId: string, evaluatorId: string, action: InviteAction) {
  const evaluation = await getEvaluation(evalId);
  assertNotFinalized(evaluation);
  const key = K.invite(evalId, evaluatorId);
  if (action.type === "remove") {
    const inv = await kv().get<Invite>(key);
    if (!inv) throw new AppError(404, "초청 정보를 찾을 수 없습니다.");
    if (inv.status !== "pending")
      throw new AppError(400, "이미 발송된 초청은 목록에서 삭제할 수 없습니다. '섭외 철회'를 이용해 주세요.");
    await kv().del(key, K.token(inv.token));
    await kv().srem(K.invites(evalId), evaluatorId);
    await kv().srem(K.evaluatorInvites(evaluatorId), evalId);
    return null;
  }
  return updateWithRetry<Invite>(
    key,
    (inv) => {
      switch (action.type) {
        case "markSent":
          if (inv.status === "withdrawn") throw new AppError(400, "철회된 초청입니다.");
          return {
            ...inv,
            status: "sent",
            sentAt: nowIso(),
            sentVia: action.via,
            log: pushLog(inv, action.via === "email" ? `이메일 발송${action.detail ? ` (${action.detail})` : ""}` : "수동 발송 완료 표시"),
          };
        case "unmarkSent":
          if (inv.response) throw new AppError(400, "이미 회신한 위원은 미발송으로 되돌릴 수 없습니다.");
          return { ...inv, status: "pending", sentAt: null, sentVia: null, log: pushLog(inv, "발송 표시 취소") };
        case "withdraw":
          return {
            ...inv,
            status: "withdrawn",
            withdrawnReason: action.reason,
            log: pushLog(inv, `섭외 철회${action.reason ? `: ${action.reason}` : ""}`),
          };
        case "reinvite":
          return {
            ...inv,
            status: inv.sentAt ? "sent" : "pending",
            withdrawnReason: "",
            log: pushLog(inv, "철회 취소(재초청)"),
          };
      }
    },
    "초청",
  );
}

// ---------- 평가위원 회신 (공개 링크) ----------

export async function resolveToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new AppError(404, "유효하지 않은 링크입니다.");
  const ref = await kv().get<{ evalId: string; evaluatorId: string }>(K.token(token));
  if (!ref) throw new AppError(404, "유효하지 않거나 만료된 링크입니다.");
  const [evaluation, evaluator, invite] = await Promise.all([
    getEvaluation(ref.evalId),
    getEvaluator(ref.evaluatorId),
    kv().get<Invite>(K.invite(ref.evalId, ref.evaluatorId)),
  ]);
  if (!invite || invite.token !== token) throw new AppError(404, "유효하지 않거나 만료된 링크입니다.");
  return { evaluation, evaluator, invite };
}

export async function submitResponse(token: string, input: z.output<typeof responseInput>) {
  const { evaluation } = await resolveToken(token);
  if (evaluation.status === "finalized")
    throw new AppError(423, "평가 일정이 이미 확정되어 응답을 변경할 수 없습니다. 담당자에게 문의해 주세요.");
  const validSlots = new Set(evaluation.slots.map((s) => s.id));
  const slotIds = input.attendance === "no" ? [] : input.slotIds.filter((s) => validSlots.has(s));
  if (input.attendance !== "no" && slotIds.length === 0)
    throw new AppError(400, "참석 가능한 일정을 1개 이상 선택해 주세요.");
  const ref = await kv().get<{ evalId: string; evaluatorId: string }>(K.token(token));
  return updateWithRetry<Invite>(
    K.invite(ref!.evalId, ref!.evaluatorId),
    (inv) => {
      if (inv.status === "withdrawn") throw new AppError(403, "해당 초청은 철회되었습니다. 담당자에게 문의해 주세요.");
      const now = nowIso();
      const first = !inv.response;
      return {
        ...inv,
        // 링크로 회신했다면 발송된 것으로 간주
        status: "sent",
        sentAt: inv.sentAt ?? now,
        response: {
          attendance: input.attendance as Attendance,
          slotIds,
          note: input.note,
          submittedAt: inv.response?.submittedAt ?? now,
          updatedAt: now,
          revision: (inv.response?.revision ?? 0) + 1,
        },
        log: pushLog(inv, first ? "평가위원 회신 제출" : "평가위원 회신 수정"),
      };
    },
    "초청",
  );
}

// ======================= 최종 확정 =======================

export async function finalizeEvaluation(
  evalId: string,
  input: { slotId: string; evaluatorIds: string[]; memo: string; version: number },
) {
  const evaluation = await getEvaluation(evalId);
  if (evaluation.status === "finalized") throw new AppError(423, "이미 최종 확정된 평가입니다.");
  const slot = evaluation.slots.find((s) => s.id === input.slotId);
  if (!slot) throw new AppError(400, "확정할 후보 일정을 선택해 주세요.");
  const ids = [...new Set(input.evaluatorIds)];
  if (ids.length === 0) throw new AppError(400, "참석 평가위원을 1명 이상 선택해 주세요.");
  const invites = await listInvites(evalId);
  const evaluators = await kv().mget<Evaluator>(ids.map(K.evaluator));
  const members = ids.map((id, i) => {
    const inv = invites.find((x) => x.evaluatorId === id);
    const v = evaluators[i];
    if (!inv || !v || inv.status === "withdrawn" || !inv.response || inv.response.attendance === "no" || !inv.response.slotIds.includes(slot.id))
      throw new AppError(400, `${v?.name ?? "선택한 위원"}님은 해당 일정에 참석 가능으로 회신하지 않았습니다.`);
    return { evaluatorId: id, name: v.name, org: v.org, attendance: inv.response.attendance };
  });
  return updateWithVersion<Evaluation>(
    K.eval(evalId),
    input.version,
    (cur) => {
      if (cur.status === "finalized") throw new AppError(423, "이미 최종 확정된 평가입니다.");
      return {
        ...cur,
        status: "finalized",
        finalization: { slotId: slot.id, slot: { ...slot }, members, finalizedAt: nowIso(), memo: input.memo },
      };
    },
    "평가",
  );
}

export { inviteCounts, slotSummary } from "./summary";

export async function resetAll() {
  await kv().flushPrefix();
}

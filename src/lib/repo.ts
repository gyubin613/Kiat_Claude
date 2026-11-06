import { kv } from "./store";
import { DEFAULT_FOLLOWUP, EDUCATION_DEFAULTS, type Attendance, type ConditionReview, type Evaluation, type Evaluator, type Invite, type Slot } from "./types";
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

export const K = {
  evals: "evaluations",
  eval: (id: string) => `evaluation:${id}`,
  evaluators: "evaluators",
  evaluator: (id: string) => `evaluator:${id}`,
  invites: (evalId: string) => `invites:${evalId}`,
  invite: (evalId: string, evaluatorId: string) => `invite:${evalId}:${evaluatorId}`,
  token: (t: string) => `token:${t}`,
  evaluatorInvites: (evaluatorId: string) => `evaluatorInvites:${evaluatorId}`,
  roster: (evalId: string) => `roster:${evalId}`,
  rosterInit: (evalId: string) => `rosterInit:${evalId}`,
  autoLock: (evalId: string) => `autoLock:${evalId}`,
  threads: (evalId: string) => `threads:${evalId}`,
  thread: (evalId: string, evaluatorId: string) => `thread:${evalId}:${evaluatorId}`,
  announcements: (evalId: string) => `announcements:${evalId}`,
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
export async function updateWithRetry<T extends Versioned>(key: string, mutate: (cur: T) => T, label: string) {
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
type EvaluationCreate = Omit<EvaluationInput, "conflictKeywords" | "recruitMode"> & { conflictKeywords?: string[]; recruitMode?: "manual" | "auto" };

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

export async function createEvaluation(input: EvaluationCreate): Promise<Evaluation> {
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
    historyWeight: input.weights?.history ?? input.historyWeight,
    weights: input.weights ?? { history: input.historyWeight, preference: 100 - input.historyWeight, overseas: 0 },
    conflictKeywords: input.conflictKeywords ?? [],
    recruitMode: input.recruitMode ?? "manual",
    autoQueue: input.autoQueue ?? [],
    autoExcluded: input.autoExcluded ?? [],
    autoRunning: false,
    autoStartedAt: null,
    emailTemplate: input.emailTemplate ?? DEFAULT_TEMPLATE,
    followup: input.followup ?? { ...DEFAULT_FOLLOWUP },
    status: "draft",
    finalization: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await kv().set(K.eval(e.id), e);
  await kv().set(K.rosterInit(e.id), true); // 새 평가는 빈 명단으로 시작
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
      if (patch.recruitMode && patch.recruitMode !== (cur.recruitMode ?? "manual") && cur.autoRunning)
        throw new AppError(400, "자동 섭외 진행 중에는 섭외 방식을 바꿀 수 없습니다. 먼저 자동 섭외를 중지해 주세요.");
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
  const threadIds = await store.smembers(K.threads(id));
  const rosterIds = await store.smembers(K.roster(id));
  const owned = ((await store.mget<Evaluator>(rosterIds.map(K.evaluator))).filter(Boolean) as Evaluator[]).filter((v) => v.evaluationId === id);
  await store.del(
    K.eval(id),
    K.roster(id),
    K.rosterInit(id),
    ...owned.map((v) => K.evaluator(v.id)),
    K.invites(id),
    K.threads(id),
    K.announcements(id),
    ...threadIds.map((v) => K.thread(id, v)),
    ...invites.map((i) => K.invite(id, i.evaluatorId)),
    ...invites.map((i) => K.token(i.token)),
  );
  for (const i of invites) await store.srem(K.evaluatorInvites(i.evaluatorId), id);
  await store.srem(K.evals, id);
}

// ======================= 평가위원 =======================

type EvaluatorInput = z.output<typeof evaluatorInput>;
type EduKey = keyof typeof EDUCATION_DEFAULTS;
type EvaluatorCreate = Omit<EvaluatorInput, EduKey> & Partial<Pick<EvaluatorInput, EduKey>>;

/** 학력 항목이 없던 이전 데이터를 기본값으로 보완 */
export function normalizeEvaluator(v: Evaluator): Evaluator {
  return { ...EDUCATION_DEFAULTS, ...v };
}

/**
 * 평가별 평가위원 명단
 * - 평가마다 독립된 명단(roster)을 가진다. 위원 레코드도 평가별로 따로 저장되어,
 *   한 평가에서 수정해도 다른 평가 명단에는 영향이 없다.
 * - 이전 버전의 '공통 명단'(evaluators)은 기존 평가에 한해 처음 열 때 그대로 연결(마이그레이션)한다.
 */
async function ensureRoster(evalId: string) {
  const store = kv();
  if (await store.get<boolean>(K.rosterInit(evalId))) return;
  if (!(await store.setnx(K.rosterInit(evalId), true))) return;
  const legacy = await store.smembers(K.evaluators);
  if (legacy.length) await store.sadd(K.roster(evalId), ...legacy);
}

async function loadEvaluators(ids: string[]) {
  const items = ((await kv().mget<Evaluator>(ids.map(K.evaluator))).filter(Boolean) as Evaluator[]).map(normalizeEvaluator);
  return items.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function listEvaluators(evalId: string): Promise<Evaluator[]> {
  await ensureRoster(evalId);
  return loadEvaluators(await kv().smembers(K.roster(evalId)));
}

export async function rosterCount(evalId: string) {
  await ensureRoster(evalId);
  return (await kv().smembers(K.roster(evalId))).length;
}

/** 이전 버전 공통 명단 (불러오기 원본으로만 사용) */
export async function listLegacyEvaluators(): Promise<Evaluator[]> {
  return loadEvaluators(await kv().smembers(K.evaluators));
}

export async function getEvaluator(id: string) {
  const v = await kv().get<Evaluator>(K.evaluator(id));
  if (!v) throw new AppError(404, "평가위원 정보를 찾을 수 없습니다.");
  return normalizeEvaluator(v);
}

async function assertInRoster(evalId: string, evaluatorId: string) {
  await ensureRoster(evalId);
  if (!(await kv().smembers(K.roster(evalId))).includes(evaluatorId))
    throw new AppError(404, "이 평가의 명단에 없는 평가위원입니다.");
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

export async function createEvaluator(evalId: string, input: EvaluatorCreate, opts: { allowDuplicate?: boolean } = {}) {
  await getEvaluation(evalId);
  const all = await listEvaluators(evalId);
  const dup = findDuplicate(input, all);
  if (dup && !opts.allowDuplicate) {
    throw new AppError(
      409,
      dup.by === "email"
        ? `이 평가 명단에 같은 이메일의 위원이 있습니다: ${dup.evaluator.name}(${dup.evaluator.org || "소속 미입력"})`
        : `이 평가 명단에 같은 성명·소속기관의 위원이 있습니다: ${dup.evaluator.name}(${dup.evaluator.org})`,
      { duplicate: dup.evaluator, by: dup.by },
    );
  }
  const now = nowIso();
  const v: Evaluator = { id: newId("v_"), ...EDUCATION_DEFAULTS, ...input, evaluationId: evalId, createdAt: now, updatedAt: now, version: 1 };
  await kv().set(K.evaluator(v.id), v);
  await kv().sadd(K.roster(evalId), v.id);
  return v;
}

export async function updateEvaluator(evalId: string, id: string, patch: Partial<EvaluatorInput>, version: number) {
  await assertInRoster(evalId, id);
  if (patch.email !== undefined || patch.name !== undefined || patch.org !== undefined) {
    const cur = await getEvaluator(id);
    const merged = { name: patch.name ?? cur.name, org: patch.org ?? cur.org, email: patch.email ?? cur.email };
    const dup = findDuplicate(merged, await listEvaluators(evalId), id);
    if (dup?.by === "email")
      throw new AppError(409, `이 평가 명단에 같은 이메일의 위원이 있습니다: ${dup.evaluator.name}`, { duplicate: dup.evaluator });
  }
  return updateWithVersion<Evaluator>(
    K.evaluator(id),
    version,
    (cur) => {
      const next = { ...normalizeEvaluator(cur), ...patch };
      if (next.pastInvited != null && next.pastAttended != null && next.pastAttended > next.pastInvited)
        throw new AppError(400, "참여 횟수는 초청 횟수보다 클 수 없습니다.");
      return next;
    },
    "평가위원",
  );
}

/** 이 평가 명단에서 제외. 이 평가에서 초청한 위원은 제외할 수 없다. */
export async function deleteEvaluator(evalId: string, id: string) {
  await assertInRoster(evalId, id);
  const store = kv();
  if (await store.get(K.invite(evalId, id))) throw new AppError(400, "이 평가에 초청한 위원은 명단에서 뺄 수 없습니다. 초청 메일 화면에서 철회해 주세요.");
  await store.srem(K.roster(evalId), id);
  const v = await store.get<Evaluator>(K.evaluator(id));
  // 이 평가 소유의 레코드이고 다른 평가에서 초청한 적이 없으면 레코드도 삭제
  if (v?.evaluationId === evalId && !(await store.smembers(K.evaluatorInvites(id))).length) await store.del(K.evaluator(id));
}

export type ImportMode = "skip" | "fill" | "overwrite";
export type ImportRowResult = {
  row: number;
  name: string;
  result: "created" | "updated" | "skipped" | "error";
  message?: string;
};

/** 엑셀 일괄 등록(이 평가 명단). 중복 시 건너뛰기 / 빈 항목만 보완 / 덮어쓰기 */
export async function importEvaluators(
  evalId: string,
  rows: { row: number; data: EvaluatorCreate }[],
  mode: ImportMode,
): Promise<ImportRowResult[]> {
  const all = await listEvaluators(evalId);
  const results: ImportRowResult[] = [];
  for (const { row, data } of rows) {
    const dup = findDuplicate(data, all);
    if (!dup) {
      const v = await createEvaluator(evalId, data, { allowDuplicate: true });
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
      const next = await updateEvaluator(evalId, cur.id, patch, cur.version);
      all.splice(all.indexOf(cur), 1, next);
      results.push({ row, name: data.name, result: "updated", message: `${Object.keys(patch).length}개 항목 반영` });
    } catch (e) {
      results.push({ row, name: data.name, result: "error", message: e instanceof Error ? e.message : "오류" });
    }
  }
  return results;
}

const COPY_FIELDS = [
  "name", "org", "email", "phone", "expertise", "pastInvited", "pastAttended", "preference", "note",
  "bachelorSchool", "bachelorMajor", "bachelorAbroad", "finalDegree", "finalSchool", "finalMajor", "finalAbroad",
  "overseasWorkYears", "overseasWorkDetail",
] as const;

export type CopyResult = { name: string; result: "created" | "skipped"; message?: string };

/**
 * 이전 평가(또는 이전 버전 공통 명단)의 위원을 이 평가 명단으로 복사한다.
 * - ids 가 없으면 전체(일괄), 있으면 선택한 위원만
 * - applyHistory: 원본 평가에서 초청(발송)했으면 초청 +1, 최종 확정 위원이면 참여 +1 을 과거 이력에 반영
 * - 이 평가 명단에 이미 있는 위원(이메일 또는 성명·소속 일치)은 건너뜀
 */
export async function copyEvaluators(
  toEvalId: string,
  from: string, // 평가 id 또는 "legacy"
  ids: string[] | null,
  opts: { applyHistory?: boolean } = {},
): Promise<CopyResult[]> {
  const target = await getEvaluation(toEvalId);
  if (target.status === "finalized") throw new AppError(423, "최종 확정된 평가의 명단은 바꿀 수 없습니다.");
  if (from === toEvalId) throw new AppError(400, "같은 평가에서는 불러올 수 없습니다.");
  const source = from === "legacy" ? null : await getEvaluation(from);
  const pool = from === "legacy" ? await listLegacyEvaluators() : await listEvaluators(from);
  const picked = ids ? pool.filter((v) => ids.includes(v.id)) : pool;
  if (!picked.length) throw new AppError(400, "불러올 위원을 선택해 주세요.");
  const invites = source ? await listInvites(source.id) : [];
  const finalIds = new Set(source?.finalization?.members.map((m) => m.evaluatorId) ?? []);
  const existing = await listEvaluators(toEvalId);
  const results: CopyResult[] = [];
  for (const v of picked) {
    const dup = findDuplicate(v, existing);
    if (dup) {
      results.push({ name: v.name, result: "skipped", message: "이미 명단에 있음" });
      continue;
    }
    const data = Object.fromEntries(COPY_FIELDS.map((k) => [k, v[k]])) as unknown as EvaluatorCreate;
    if (opts.applyHistory && source) {
      const inv = invites.find((i) => i.evaluatorId === v.id);
      if (inv && inv.status !== "pending") {
        data.pastInvited = (v.pastInvited ?? 0) + 1;
        data.pastAttended = (v.pastAttended ?? 0) + (finalIds.has(v.id) ? 1 : 0);
      }
    }
    const created = await createEvaluator(toEvalId, data, { allowDuplicate: true });
    existing.push(created);
    results.push({ name: v.name, result: "created" });
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

export async function createInvites(evalId: string, evaluatorIds: string[], opts: { logNote?: string; auto?: boolean } = {}) {
  const store = kv();
  const evaluation = await getEvaluation(evalId);
  assertNotFinalized(evaluation);
  const existing = await listInvites(evalId);
  const round = existing.length ? Math.max(...existing.map((i) => i.round)) + (existing.some((i) => i.status !== "pending") ? 1 : 0) : 1;
  const created: Invite[] = [];
  for (const evaluatorId of [...new Set(evaluatorIds)]) {
    if (existing.some((i) => i.evaluatorId === evaluatorId)) continue;
    await assertInRoster(evalId, evaluatorId);
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
      log: [{ at: now, action: `${round}차 초청 대상으로 선정${opts.logNote ? ` (${opts.logNote})` : ""}` }],
      escalatedAt: null,
      autoInvited: Boolean(opts.auto),
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

/** 무응답·불참 위원에 대해 다음 순위 안내 처리를 기록 (중복 처리 방지) */
export async function markEscalated(evalId: string, evaluatorId: string, note: string) {
  return updateWithRetry<Invite>(
    K.invite(evalId, evaluatorId),
    (inv) => (inv.escalatedAt ? inv : { ...inv, escalatedAt: nowIso(), log: pushLog(inv, note) }),
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
        // 회신을 수정하면 조건부 검토 결과는 다시 검토하도록 초기화
        conditionReview: null,
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

// ======================= 자동 섭외 =======================

export async function setAutoRunning(evalId: string, running: boolean, order?: { queue?: string[]; excluded?: string[] }) {
  return updateWithRetry<Evaluation>(
    K.eval(evalId),
    (cur) => {
      if (cur.status === "finalized") throw new AppError(423, "최종 확정된 평가입니다.");
      if (cur.recruitMode !== "auto") throw new AppError(400, "자동 섭외로 설정된 평가가 아닙니다.");
      return {
        ...cur,
        autoRunning: running,
        autoStartedAt: running ? (cur.autoStartedAt ?? nowIso()) : cur.autoStartedAt ?? null,
        ...(order?.queue ? { autoQueue: order.queue } : {}),
        ...(order?.excluded ? { autoExcluded: order.excluded } : {}),
      };
    },
    "평가",
  );
}

// ======================= 조건부 참석 검토 =======================

export async function reviewCondition(
  evalId: string,
  evaluatorId: string,
  decision: ConditionReview["decision"] | null,
  note: string,
) {
  assertNotFinalized(await getEvaluation(evalId));
  return updateWithRetry<Invite>(
    K.invite(evalId, evaluatorId),
    (inv) => {
      if (inv.response?.attendance !== "conditional") throw new AppError(400, "조건부 참석으로 회신한 위원만 검토할 수 있습니다.");
      if (inv.status === "withdrawn") throw new AppError(400, "철회된 초청입니다.");
      return {
        ...inv,
        conditionReview: decision ? { decision, note, at: nowIso() } : null,
        log: pushLog(inv, decision ? `조건부 참석 ${decision === "accepted" ? "수락" : "거절"}${note ? `: ${note}` : ""}` : "조건부 검토 취소"),
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
    if (inv.response.attendance === "conditional" && inv.conditionReview?.decision !== "accepted")
      throw new AppError(400, `${v.name}님은 조건부 참석 회신입니다. 조건을 먼저 수락해야 확정할 수 있습니다.`);
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

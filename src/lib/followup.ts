// 무응답(·불참) 시 다음 순위 위원 자동 후속 안내
import { applyInviteAction, createInvites, getEvaluation, K, listEvaluations, listEvaluators, listInvites, markEscalated } from "./repo";

export function cronBaseUrl(fallback?: string) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return fallback ?? "http://localhost:3000";
}
import { renderTemplate } from "./email";
import { canAutoSend, deliver } from "./mailer";
import { autoOrder, rankEvaluators } from "./scoring";
import { kv } from "./store";
import { isDeclined } from "./summary";
import { followupOf, weightsOf, type Evaluation, type Invite } from "./types";

export type FollowupPlan = {
  needed: number;
  triggers: Invite[]; // 이번에 처리할 무응답·불참 초청
  overdue: number;
};

/** 순수 계산: 현재 시점에서 몇 명을 추가로 안내해야 하는지 */
export function planFollowup(e: Evaluation, invites: Invite[], now: Date): FollowupPlan {
  const f = followupOf(e);
  const windowMs = f.hours * 3600 * 1000;
  const active = invites.filter((i) => i.status !== "withdrawn");
  const isOverdue = (i: Invite) => i.status === "sent" && !i.response && !!i.sentAt && now.getTime() - new Date(i.sentAt).getTime() >= windowMs;
  // 확정 후보 + 검토 전 조건부 회신을 확보 인원으로 본다 (거절된 조건부·불참 제외)
  const confirmed = active.filter((i) => i.response && !isDeclined(i)).length;
  const inWindow = active.filter((i) => i.status === "sent" && !i.response && !isOverdue(i)).length;
  const notSent = active.filter((i) => i.status === "pending").length;
  const triggers = active.filter(
    (i) => !i.escalatedAt && (isOverdue(i) || (f.onDecline && isDeclined(i))),
  );
  return {
    needed: Math.max(0, e.seats - confirmed - inWindow - notSent),
    triggers,
    overdue: active.filter(isOverdue).length,
  };
}

export type FollowupResult = {
  evaluationId: string;
  name: string;
  triggered: number;
  invited: { name: string; sent: boolean; detail?: string }[];
  note?: string;
};

/** 같은 평가에 대해 동시에 두 번 실행되지 않도록 잠금 (60초 지나면 풀린 것으로 본다) */
async function withLock<T>(evalId: string, fn: () => Promise<T>): Promise<T | null> {
  const store = kv();
  const key = K.autoLock(evalId);
  if (!(await store.setnx(key, Date.now()))) {
    const at = await store.get<number>(key);
    if (at && Date.now() - at < 60_000) return null;
    await store.set(key, Date.now());
  }
  try {
    return await fn();
  } finally {
    await store.del(key);
  }
}

export async function runFollowupFor(evalId: string, baseUrl: string, now = new Date()): Promise<FollowupResult | null> {
  return withLock(evalId, () => runFollowupInner(evalId, baseUrl, now)).then((r) => r ?? null);
}

async function runFollowupInner(evalId: string, baseUrl: string, now: Date): Promise<FollowupResult | null> {
  const e = await getEvaluation(evalId);
  const f = followupOf(e);
  const auto = e.recruitMode === "auto";
  if (!f.enabled || e.status === "finalized") return null;
  if (auto && !e.autoRunning) return null;
  const invites = await listInvites(evalId);
  const plan = planFollowup(e, invites, now);
  // 수동 모드: 무응답·불참이 생겼을 때만. 자동 섭외: 배석 인원이 부족하면 언제든 다음 순서로 채운다
  if (!plan.triggers.length && !(auto && plan.needed > 0)) return null;

  const k = auto ? plan.needed : Math.min(plan.needed, plan.triggers.length);
  const invitedIds = new Set(invites.map((i) => i.evaluatorId));
  const roster = await listEvaluators(evalId);
  const pool = auto
    ? (() => {
        const order = autoOrder(roster, e, weightsOf(e)).filter((v) => !invitedIds.has(v.id));
        // 순서는 지키되, 이메일이 없는 위원은 자동 발송이 불가하므로 뒤로
        return [...order.filter((v) => v.email), ...order.filter((v) => !v.email)];
      })()
    : (() => {
        const ranked = rankEvaluators(roster, weightsOf(e)).filter((v) => !invitedIds.has(v.id));
        return f.autoSend ? [...ranked.filter((v) => v.email), ...ranked.filter((v) => !v.email)] : ranked;
      })();
  const picks = pool.slice(0, k);

  const reason = (i: Invite) =>
    i.response?.attendance === "no" ? "참석 불가" : i.response ? "조건부 거절" : `${f.hours}시간 무응답`;
  const note =
    k === 0
      ? "필요 인원이 확보되어 추가 안내 없음"
      : picks.length === 0
        ? "다음 순서 위원이 없어 더 보내지 못함"
        : picks.length < k
          ? `후보 부족: ${picks.length}명만 추가 안내`
          : undefined;

  // 트리거 표시를 먼저 기록하여 동시 실행 시 중복 안내를 막는다
  for (const t of plan.triggers) {
    await markEscalated(evalId, t.evaluatorId, `${reason(t)} → ${k ? "다음 순위 자동 안내" : "추가 안내 없음(인원 충분)"}`);
  }

  const invited: FollowupResult["invited"] = [];
  if (picks.length) {
    // createInvites 는 이미 있는 위원을 건너뛰므로, 실제로 새로 만든 초청에만 발송 (동시 실행 시 중복 발송 방지)
    const why = plan.triggers.length ? plan.triggers.map(reason).join(", ") : "자동 섭외 순서";
    const created = await createInvites(
      evalId,
      picks.map((p) => p.id),
      { auto: true, logNote: `${auto ? "자동 섭외" : "자동 후속 안내"}: ${why}` },
    );
    const latest = await getEvaluation(evalId);
    for (const p of picks) {
      const inv = created.find((i) => i.evaluatorId === p.id);
      if (!inv) continue;
      if (f.autoSend && canAutoSend(p.email)) {
        const mail = renderTemplate(latest.emailTemplate, { evaluation: latest, evaluator: p, link: `${baseUrl}/r/${inv.token}` });
        const r = await deliver(p.email, mail);
        if (r.status === "sent") await applyInviteAction(evalId, p.id, { type: "markSent", via: "email", detail: `자동 · ${p.email}` });
        invited.push({ name: p.name, sent: r.status === "sent", detail: r.detail });
      } else {
        invited.push({ name: p.name, sent: false, detail: f.autoSend ? "메일 설정 전이거나 발송 허용 주소가 아님 — 직접 발송 필요" : "자동 발송 꺼짐 — 수동 발송 필요" });
      }
    }
  }
  return { evaluationId: evalId, name: e.name, triggered: plan.triggers.length, invited, note };
}

/**
 * 회신·철회·조건 거절 직후 호출: 불참이 생겼으면 바로 다음 순서로 넘긴다.
 * 응답 속도를 위해 가능하면 응답을 보낸 뒤(after) 실행한다.
 */
export async function afterDecline(evalId: string, baseUrl: string) {
  const job = () => runFollowupFor(evalId, baseUrl).catch((e) => console.error("자동 후속 처리 실패", e));
  try {
    const { after } = await import("next/server");
    after(job);
  } catch {
    await job();
  }
}

export async function runAllFollowups(baseUrl: string, now = new Date()) {
  const evals = await listEvaluations();
  const results: FollowupResult[] = [];
  for (const e of evals) {
    if (!followupOf(e).enabled || e.status === "finalized" || (e.recruitMode === "auto" && !e.autoRunning)) continue;
    try {
      const r = await runFollowupFor(e.id, baseUrl, now);
      if (r) results.push(r);
    } catch (err) {
      results.push({ evaluationId: e.id, name: e.name, triggered: 0, invited: [], note: err instanceof Error ? err.message : "오류" });
    }
  }
  // 처리 결과를 담당자에게 메일로 알림 (설정된 경우)
  const to = process.env.ADMIN_NOTIFY_EMAIL;
  const acted = results.filter((r) => r.invited.length || r.note);
  if (to && acted.length) {
    await deliver(to, {
      subject: `[자동 후속 안내] ${acted.length}건 처리`,
      body: acted
        .map((r) => `■ ${r.name}\n${r.invited.map((i) => `  - ${i.name}: ${i.sent ? "메일 발송" : `초청 추가(${i.detail})`}`).join("\n")}${r.note ? `\n  ※ ${r.note}` : ""}`)
        .join("\n\n") + `\n\n관리 화면: ${baseUrl}/admin/invites`,
    });
  }
  return results;
}

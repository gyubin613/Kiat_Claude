import { body, handle, json } from "@/lib/api";
import { createEvaluation, inviteCounts, listEvaluations, listInvites, rosterCount } from "@/lib/repo";
import { listThreads } from "@/lib/comm";
import { followupOf, pendingQuestion } from "@/lib/types";
import { evaluationInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const evals = await listEvaluations();
  const withCounts = await Promise.all(
    evals.map(async (e) => {
      const [invites, threads, roster] = await Promise.all([listInvites(e.id), listThreads(e.id), rosterCount(e.id)]);
      const f = followupOf(e);
      const now = Date.now();
      const overdue = invites.filter(
        (i) => i.status === "sent" && !i.response && i.sentAt && now - new Date(i.sentAt).getTime() >= f.hours * 3600 * 1000,
      ).length;
      return {
        ...e,
        counts: inviteCounts(invites),
        rosterCount: roster,
        unread: threads.reduce((n, t) => n + t.unreadAdmin, 0),
        questionsWaiting: threads.filter((t) => pendingQuestion(t)).length,
        overdue,
      };
    }),
  );
  return json({ evaluations: withCounts });
});

export const POST = handle(async (req: Request) => {
  const input = await body(req, evaluationInput);
  return json({ evaluation: await createEvaluation(input) }, 201);
});

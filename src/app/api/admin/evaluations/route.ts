import { body, handle, json } from "@/lib/api";
import { createEvaluation, inviteCounts, listEvaluations, listInvites } from "@/lib/repo";
import { listThreads } from "@/lib/comm";
import { evaluationInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const evals = await listEvaluations();
  const withCounts = await Promise.all(
    evals.map(async (e) => {
      const [invites, threads] = await Promise.all([listInvites(e.id), listThreads(e.id)]);
      return { ...e, counts: inviteCounts(invites), unread: threads.reduce((n, t) => n + t.unreadAdmin, 0) };
    }),
  );
  return json({ evaluations: withCounts });
});

export const POST = handle(async (req: Request) => {
  const input = await body(req, evaluationInput);
  return json({ evaluation: await createEvaluation(input) }, 201);
});

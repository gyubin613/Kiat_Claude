import { body, handle, json } from "@/lib/api";
import { createEvaluation, inviteCounts, listEvaluations, listInvites } from "@/lib/repo";
import { evaluationInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const evals = await listEvaluations();
  const withCounts = await Promise.all(evals.map(async (e) => ({ ...e, counts: inviteCounts(await listInvites(e.id)) })));
  return json({ evaluations: withCounts });
});

export const POST = handle(async (req: Request) => {
  const input = await body(req, evaluationInput);
  return json({ evaluation: await createEvaluation(input) }, 201);
});

import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { createEvaluator, listEvaluators } from "@/lib/repo";
import { evaluatorInput } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

/** 이 평가의 평가위원 명단 */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json({ evaluators: await listEvaluators(id) });
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { allowDuplicate, ...rest } = await body(req, z.object({ allowDuplicate: z.boolean().optional() }).passthrough());
  const input = evaluatorInput.parse(rest);
  return json({ evaluator: await createEvaluator(id, input, { allowDuplicate }) }, 201);
});

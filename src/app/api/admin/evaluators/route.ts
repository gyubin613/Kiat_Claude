import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { createEvaluator, listEvaluators } from "@/lib/repo";
import { evaluatorInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handle(async () => json({ evaluators: await listEvaluators() }));

export const POST = handle(async (req: Request) => {
  const { allowDuplicate, ...rest } = await body(
    req,
    z.object({ allowDuplicate: z.boolean().optional() }).passthrough(),
  );
  const input = evaluatorInput.parse(rest);
  return json({ evaluator: await createEvaluator(input, { allowDuplicate }) }, 201);
});

import { body, handle, json } from "@/lib/api";
import { deleteEvaluation, getEvaluation, updateEvaluation } from "@/lib/repo";
import { evaluationPatch } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json({ evaluation: await getEvaluation(id) });
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { version, ...patch } = await body(req, evaluationPatch);
  return json({ evaluation: await updateEvaluation(id, patch, version) });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteEvaluation(id);
  return json({ ok: true });
});

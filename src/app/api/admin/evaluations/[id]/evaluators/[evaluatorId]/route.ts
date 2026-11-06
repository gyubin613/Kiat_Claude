import { body, handle, json } from "@/lib/api";
import { deleteEvaluator, updateEvaluator } from "@/lib/repo";
import { evaluatorPatch } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string; evaluatorId: string }> };

/** 변경된 항목만 받아 저장 — 보내지 않은 항목은 기존 값 유지 */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  const { version, ...patch } = await body(req, evaluatorPatch);
  return json({ evaluator: await updateEvaluator(id, evaluatorId, patch, version) });
});

/** 이 평가 명단에서 제외 */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  await deleteEvaluator(id, evaluatorId);
  return json({ ok: true });
});

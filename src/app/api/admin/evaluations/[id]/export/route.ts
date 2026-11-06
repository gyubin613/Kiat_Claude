import { handle } from "@/lib/api";
import { buildResponsesWorkbook, xlsxResponse } from "@/lib/excel";
import { getEvaluation, listEvaluators, listInvites } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };
export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [e, invites, evaluators] = await Promise.all([getEvaluation(id), listInvites(id), listEvaluators(id)]);
  const buf = await buildResponsesWorkbook(e, invites, new Map(evaluators.map((v) => [v.id, v])));
  const safe = e.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return xlsxResponse(buf, `${safe}_회신현황.xlsx`);
});

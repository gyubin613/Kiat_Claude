import { handle } from "@/lib/api";
import { buildRosterWorkbook, xlsxResponse } from "@/lib/excel";
import { getEvaluation, listEvaluators } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 이 평가의 명단을 등록 양식과 같은 형식으로 내려받기 (편집 후 다른 평가에 다시 업로드 가능) */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [e, list] = await Promise.all([getEvaluation(id), listEvaluators(id)]);
  const safe = e.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return xlsxResponse(await buildRosterWorkbook(list), `${safe}_평가위원명단.xlsx`);
});

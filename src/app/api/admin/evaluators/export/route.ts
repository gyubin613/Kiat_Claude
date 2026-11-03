import { handle } from "@/lib/api";
import { buildRosterWorkbook, xlsxResponse } from "@/lib/excel";
import { listEvaluators } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => xlsxResponse(await buildRosterWorkbook(await listEvaluators()), "평가위원_명단.xlsx"));

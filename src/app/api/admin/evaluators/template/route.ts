import { handle } from "@/lib/api";
import { buildTemplateWorkbook, xlsxResponse } from "@/lib/excel";

export const runtime = "nodejs";

export const GET = handle(async () => xlsxResponse(await buildTemplateWorkbook(), "평가위원_등록양식.xlsx"));

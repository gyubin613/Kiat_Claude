import { z } from "zod";
import { baseUrl, body, handle, json } from "@/lib/api";
import { runAllFollowups, runFollowupFor } from "@/lib/followup";

/** 관리자 화면에서 즉시 점검 (화면 진입 시 자동 호출 + '지금 점검' 버튼) */
export const POST = handle(async (req: Request) => {
  const { evaluationId } = await body(req, z.object({ evaluationId: z.string().max(40).optional() }));
  const results = evaluationId
    ? [await runFollowupFor(evaluationId, baseUrl(req))].filter(Boolean)
    : await runAllFollowups(baseUrl(req));
  return json({ results });
});

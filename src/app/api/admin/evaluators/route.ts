import { handle, json } from "@/lib/api";
import { listLegacyEvaluators } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** 이전 버전 공통 명단 (평가별 명단 도입 전 데이터, 불러오기 원본으로만 사용) */
export const GET = handle(async () => json({ evaluators: await listLegacyEvaluators() }));

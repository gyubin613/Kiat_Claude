import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { copyEvaluators, listEvaluations, listLegacyEvaluators, rosterCount } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

/** 불러올 수 있는 원본 목록: 다른 평가들 + (있다면) 이전 버전 공통 명단 */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const evals = (await listEvaluations()).filter((e) => e.id !== id);
  const sources = await Promise.all(
    evals.map(async (e) => ({ id: e.id, name: e.name, status: e.status, createdAt: e.createdAt, count: await rosterCount(e.id) })),
  );
  const legacy = (await listLegacyEvaluators()).length;
  return json({
    sources: [...sources.filter((s) => s.count > 0), ...(legacy ? [{ id: "legacy", name: "이전 버전 공통 명단", status: "draft", createdAt: "", count: legacy }] : [])],
  });
});

/** 불러오기: ids 없으면 일괄, 있으면 선택 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await body(
    req,
    z.object({
      from: z.string().max(40),
      ids: z.array(z.string().max(40)).max(500).nullable().default(null),
      applyHistory: z.boolean().default(true),
    }),
  );
  return json({ results: await copyEvaluators(id, input.from, input.ids, { applyHistory: input.applyHistory }) });
});

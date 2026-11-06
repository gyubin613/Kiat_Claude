import { z } from "zod";
import { baseUrl, body, handle, json } from "@/lib/api";
import { runFollowupFor } from "@/lib/followup";
import { setAutoRunning } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 자동 섭외 시작·중지
 * - start: 순서(queue)·제외(excluded)를 저장하고, 배석 인원만큼 앞 순서부터 바로 초청 메일 발송
 * - stop: 더 이상 자동으로 보내지 않음 (이미 보낸 초청은 유지)
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await body(
    req,
    z.object({
      action: z.enum(["start", "stop"]),
      queue: z.array(z.string().max(40)).max(500).optional(),
      excluded: z.array(z.string().max(40)).max(500).optional(),
    }),
  );
  if (input.action === "stop") return json({ evaluation: await setAutoRunning(id, false), result: null });
  const evaluation = await setAutoRunning(id, true, { queue: input.queue, excluded: input.excluded });
  const result = await runFollowupFor(id, baseUrl(req));
  return json({ evaluation, result });
});

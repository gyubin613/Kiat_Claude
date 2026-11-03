import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { finalizeEvaluation } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await body(
    req,
    z.object({
      slotId: z.string().max(40),
      evaluatorIds: z.array(z.string().max(40)).max(50),
      memo: z.string().trim().max(1000).default(""),
      version: z.number().int(),
    }),
  );
  return json({ evaluation: await finalizeEvaluation(id, input) });
});

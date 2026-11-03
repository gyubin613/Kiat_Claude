import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { applyInviteAction } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string; evaluatorId: string }> };

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("markSent"), via: z.literal("manual").default("manual") }),
  z.object({ type: z.literal("unmarkSent") }),
  z.object({ type: z.literal("withdraw"), reason: z.string().trim().max(300).default("") }),
  z.object({ type: z.literal("reinvite") }),
  z.object({ type: z.literal("remove") }),
]);

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  const a = await body(req, action);
  return json({ invite: await applyInviteAction(id, evaluatorId, a) });
});

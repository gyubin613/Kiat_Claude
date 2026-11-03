import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { createInvites, listInvites } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json({ invites: await listInvites(id) });
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { evaluatorIds } = await body(req, z.object({ evaluatorIds: z.array(z.string().max(40)).min(1, "초청할 위원을 선택해 주세요.").max(100) }));
  const created = await createInvites(id, evaluatorIds);
  return json({ created: created.length }, 201);
});

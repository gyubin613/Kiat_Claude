import { z } from "zod";
import { baseUrl, body, handle, json } from "@/lib/api";
import { getThread, markReadByAdmin, postAdminMessage } from "@/lib/comm";
import { adminMessageInput } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string; evaluatorId: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  return json({ thread: await getThread(id, evaluatorId) });
});

/** 답변·개별 안내 작성 (sendEmail=true 이면 위원에게 메일 발송) / {read:true} 이면 읽음 처리 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  const raw = await req.clone().json().catch(() => ({}));
  if (raw && raw.read === true) {
    z.object({ read: z.literal(true) }).parse(raw);
    return json({ thread: await markReadByAdmin(id, evaluatorId) });
  }
  const input = await body(req, adminMessageInput);
  return json(await postAdminMessage(id, evaluatorId, input.body, input.sendEmail, baseUrl(req)));
});

import { baseUrl, body, handle, json } from "@/lib/api";
import { postEvaluatorMessage } from "@/lib/comm";
import { messageInput } from "@/lib/validate";

type Ctx = { params: Promise<{ token: string }> };

/** 평가위원 문의 등록 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params;
  const { body: text } = await body(req, messageInput);
  const t = await postEvaluatorMessage(token, text, baseUrl(req));
  return json({ messages: t.messages.map((m) => ({ id: m.id, from: m.from, body: m.body, at: m.at })) }, 201);
});

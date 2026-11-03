import { z } from "zod";
import { baseUrl, body, handle, json } from "@/lib/api";
import { applyInviteAction, reviewCondition } from "@/lib/repo";
import { postAdminMessage } from "@/lib/comm";

type Ctx = { params: Promise<{ id: string; evaluatorId: string }> };

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("markSent"), via: z.literal("manual").default("manual") }),
  z.object({ type: z.literal("unmarkSent") }),
  z.object({ type: z.literal("withdraw"), reason: z.string().trim().max(300).default("") }),
  z.object({ type: z.literal("reinvite") }),
  z.object({ type: z.literal("remove") }),
  z.object({
    type: z.literal("reviewCondition"),
    decision: z.enum(["accepted", "rejected"]).nullable(),
    note: z.string().trim().max(1000).default(""),
    notify: z.boolean().default(false), // 위원에게 결과 안내 (회신 화면 게시 + 메일)
  }),
]);

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  const a = await body(req, action);
  if (a.type === "reviewCondition") {
    const invite = await reviewCondition(id, evaluatorId, a.decision, a.note);
    let message = null;
    if (a.notify && a.decision) {
      const text =
        a.decision === "accepted"
          ? `제시하신 참석 조건을 확인하였습니다. 조건을 반영하여 참석 위원 후보로 검토하겠습니다.${a.note ? `\n\n${a.note}` : ""}`
          : `제시하신 참석 조건은 이번 평가 운영상 반영이 어렵게 되었습니다. 양해 부탁드립니다.${a.note ? `\n\n${a.note}` : ""}`;
      message = await postAdminMessage(id, evaluatorId, text, true, baseUrl(req));
    }
    return json({ invite, email: message?.email ?? null, link: message?.link ?? null });
  }
  return json({ invite: await applyInviteAction(id, evaluatorId, a) });
});

import { z } from "zod";
import { baseUrl, body, handle, json } from "@/lib/api";
import { renderTemplate } from "@/lib/email";
import { deliver, emailServiceStatus } from "@/lib/mailer";
import { AppError, applyInviteAction, getEvaluation, listEvaluators, listInvites } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const maxDuration = 60;

/** 선택한 위원들에게 초청 메일 일괄 발송 (허용 주소만, 성공한 위원은 발송 완료로 기록) */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { evaluatorIds } = await body(req, z.object({ evaluatorIds: z.array(z.string().max(40)).min(1, "보낼 위원을 선택해 주세요.").max(50, "한 번에 50명까지 보낼 수 있습니다.") }));
  if (!emailServiceStatus().configured) throw new AppError(400, "메일 발송 설정이 없습니다.");
  const evaluation = await getEvaluation(id);
  if (evaluation.status === "finalized") throw new AppError(423, "최종 확정된 평가입니다.");
  const [invites, roster] = await Promise.all([listInvites(id), listEvaluators(id)]);
  const byId = new Map(roster.map((v) => [v.id, v]));
  const results: { evaluatorId: string; name: string; status: "sent" | "failed" | "skipped"; detail?: string }[] = [];
  for (const evaluatorId of [...new Set(evaluatorIds)]) {
    const inv = invites.find((i) => i.evaluatorId === evaluatorId);
    const v = byId.get(evaluatorId);
    if (!inv || !v) continue;
    if (inv.status === "withdrawn") {
      results.push({ evaluatorId, name: v.name, status: "skipped", detail: "철회된 초청" });
      continue;
    }
    const mail = renderTemplate(evaluation.emailTemplate, { evaluation, evaluator: v, link: `${baseUrl(req)}/r/${inv.token}` });
    const r = await deliver(v.email, mail);
    if (r.status === "sent") await applyInviteAction(id, evaluatorId, { type: "markSent", via: "email", detail: v.email });
    results.push({ evaluatorId, name: v.name, status: r.status, detail: r.detail });
  }
  return json({ results });
});

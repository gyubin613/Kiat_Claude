import { z } from "zod";
import { baseUrl, body, handle, json } from "@/lib/api";
import { emailServiceStatus, recipientAllowed, renderTemplate, sendViaResend } from "@/lib/email";
import { AppError, applyInviteAction, getEvaluation, getEvaluator, listInvites } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string; evaluatorId: string }> };

/**
 * 외부 발송 서비스 연동 (단계적 검토용)
 * - test: 평가위원 대신 지정한 시험 주소로 동일 내용 발송 (발송 상태는 바꾸지 않음)
 * - direct: 평가위원에게 직접 발송. EMAIL_ALLOWED_RECIPIENTS 허용목록에 있는 주소만 가능
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  const input = await body(
    req,
    z.object({ mode: z.enum(["test", "direct"]), to: z.string().trim().email("시험 수신 주소를 확인해 주세요.").optional() }),
  );
  const status = emailServiceStatus();
  if (!status.configured) throw new AppError(400, "이메일 발송 서비스(RESEND_API_KEY, EMAIL_FROM)가 설정되지 않았습니다.");
  const [evaluation, evaluator, invites] = await Promise.all([getEvaluation(id), getEvaluator(evaluatorId), listInvites(id)]);
  const inv = invites.find((i) => i.evaluatorId === evaluatorId);
  if (!inv) throw new AppError(404, "초청 정보를 찾을 수 없습니다.");
  if (inv.status === "withdrawn") throw new AppError(400, "철회된 초청입니다.");
  const mail = renderTemplate(evaluation.emailTemplate, { evaluation, evaluator, link: `${baseUrl(req)}/r/${inv.token}` });

  const to = input.mode === "test" ? input.to : evaluator.email;
  if (!to) throw new AppError(400, input.mode === "test" ? "시험 수신 주소를 입력해 주세요." : "평가위원 이메일이 등록되어 있지 않습니다.");
  if (!recipientAllowed(to, status.allowList))
    throw new AppError(403, `수신자 제한: ${to} 은(는) 발송 허용목록(EMAIL_ALLOWED_RECIPIENTS)에 없습니다.`);

  const result = await sendViaResend(to, input.mode === "test" ? { ...mail, subject: `[시험발송] ${mail.subject}` } : mail);
  if (!result.ok) throw new AppError(502, result.error);
  if (input.mode === "direct") await applyInviteAction(id, evaluatorId, { type: "markSent", via: "email", detail: to });
  return json({ ok: true, id: result.id, to });
});

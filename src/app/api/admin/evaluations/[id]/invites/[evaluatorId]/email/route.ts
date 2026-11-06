import { z } from "zod";
import { baseUrl, body, handle, json } from "@/lib/api";
import { renderTemplate } from "@/lib/email";
import { emailServiceStatus, recipientAllowed, sendMail } from "@/lib/mailer";
import { AppError, applyInviteAction, getEvaluation, getEvaluator, listInvites } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string; evaluatorId: string }> };
export const runtime = "nodejs";

/**
 * 초청 메일 실제 발송
 * - test: 위원 대신 담당자가 입력한 주소로 같은 내용을 보냄 (발송 상태는 바꾸지 않음, 허용목록 미적용)
 * - direct: 위원에게 발송 (EMAIL_ALLOWED_RECIPIENTS 허용 주소만) → 발송 완료로 기록
 */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id, evaluatorId } = await params;
  const input = await body(
    req,
    z.object({ mode: z.enum(["test", "direct"]), to: z.string().trim().email("시험 수신 주소를 확인해 주세요.").optional() }),
  );
  const status = emailServiceStatus();
  if (!status.configured) throw new AppError(400, "메일 발송 설정이 없습니다. 환경설정 화면의 안내에 따라 설정해 주세요.");
  const [evaluation, evaluator, invites] = await Promise.all([getEvaluation(id), getEvaluator(evaluatorId), listInvites(id)]);
  const inv = invites.find((i) => i.evaluatorId === evaluatorId);
  if (!inv) throw new AppError(404, "초청 정보를 찾을 수 없습니다.");
  if (inv.status === "withdrawn") throw new AppError(400, "철회된 초청입니다.");
  if (input.mode === "direct" && evaluation.status === "finalized") throw new AppError(423, "최종 확정된 평가입니다.");
  const mail = renderTemplate(evaluation.emailTemplate, { evaluation, evaluator, link: `${baseUrl(req)}/r/${inv.token}` });

  const to = input.mode === "test" ? input.to : evaluator.email;
  if (!to) throw new AppError(400, input.mode === "test" ? "시험 수신 주소를 입력해 주세요." : "평가위원 이메일이 등록되어 있지 않습니다.");
  if (input.mode === "direct" && !recipientAllowed(to, status.allowList))
    throw new AppError(403, `발송 허용 주소가 아닙니다: ${to} (EMAIL_ALLOWED_RECIPIENTS에 추가해야 보낼 수 있습니다)`);

  const result = await sendMail(to, input.mode === "test" ? { ...mail, subject: `[시험발송] ${mail.subject}` } : mail);
  if (!result.ok) throw new AppError(502, result.error);
  if (input.mode === "direct") await applyInviteAction(id, evaluatorId, { type: "markSent", via: "email", detail: to });
  return json({ ok: true, id: result.id, to });
});

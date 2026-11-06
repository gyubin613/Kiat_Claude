import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { emailServiceStatus, sendMail } from "@/lib/mailer";
import { AppError } from "@/lib/repo";

export const runtime = "nodejs";

/** 메일 설정 점검용 시험 메일 (고정 문구, 허용목록 미적용) */
export const POST = handle(async (req: Request) => {
  const { to } = await body(req, z.object({ to: z.string().trim().email("받을 주소를 확인해 주세요.") }));
  const st = emailServiceStatus();
  if (!st.configured) throw new AppError(400, "메일 발송 설정이 없습니다.");
  const r = await sendMail(to, {
    subject: "[시험발송] 평가위원 섭외 시스템 메일 설정 확인",
    body: `이 메일은 평가위원 섭외·일정조율 시스템의 메일 발송 설정을 확인하기 위한 시험 메일입니다.\n\n발송 방식: ${st.provider === "smtp" ? "메일 계정(SMTP)" : "Resend"}\n보내는 주소: ${st.from}\n\n이 메일을 받으셨다면 설정이 정상입니다.`,
  });
  if (!r.ok) throw new AppError(502, r.error);
  return json({ ok: true, to });
});

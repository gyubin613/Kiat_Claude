import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock("nodemailer", () => ({ default: { createTransport: createTransportMock } }));

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_SECURE", "EMAIL_FROM", "EMAIL_FROM_NAME", "EMAIL_ALLOWED_RECIPIENTS", "RESEND_API_KEY", "ADMIN_NOTIFY_EMAIL", "EMAIL_REPLY_TO"];

describe("메일 실제 발송 (SMTP)", () => {
  beforeEach(async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    (await import("@/lib/mailer")).__resetMailerForTests();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  const naver = () => {
    process.env.SMTP_HOST = "smtp.naver.com";
    process.env.SMTP_USER = "me@naver.com";
    process.env.SMTP_PASS = "app-password";
    process.env.EMAIL_FROM_NAME = "기술평가팀";
  };

  it("설정이 없으면 보내지 않고 미발송으로 기록", async () => {
    const { deliver, emailServiceStatus } = await import("@/lib/mailer");
    expect(emailServiceStatus().configured).toBe(false);
    expect(await deliver("a@example.com", { subject: "s", body: "b" })).toEqual({ status: "skipped", detail: "메일 발송 설정 없음" });
  });

  it("네이버 SMTP 설정: 465 SSL, 보내는 주소는 로그인 계정, 표시 이름 포함", async () => {
    naver();
    process.env.EMAIL_ALLOWED_RECIPIENTS = "@example.com";
    process.env.ADMIN_NOTIFY_EMAIL = "admin@example.com";
    sendMailMock.mockResolvedValue({ messageId: "<m1>" });
    const { deliver, emailServiceStatus } = await import("@/lib/mailer");
    expect(emailServiceStatus()).toMatchObject({ provider: "smtp", from: "me@naver.com" });
    const r = await deliver("v1@example.com", { subject: "초청", body: "본문" });
    expect(r).toEqual({ status: "sent", detail: "v1@example.com" });
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.naver.com", port: 465, secure: true, auth: { user: "me@naver.com", pass: "app-password" } }));
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: '"기술평가팀" <me@naver.com>', to: "v1@example.com", subject: "초청", text: "본문", replyTo: "admin@example.com" }));
  });

  it("허용목록 밖 주소는 보내지 않고, '*'는 모두 허용", async () => {
    naver();
    sendMailMock.mockResolvedValue({ messageId: "x" });
    const { deliver } = await import("@/lib/mailer");
    process.env.EMAIL_ALLOWED_RECIPIENTS = "me@naver.com";
    expect((await deliver("other@example.com", { subject: "s", body: "b" })).status).toBe("skipped");
    process.env.EMAIL_ALLOWED_RECIPIENTS = "*";
    expect((await deliver("other@example.com", { subject: "s", body: "b" })).status).toBe("sent");
  });

  it("로그인 실패는 해결 방법이 담긴 안내로 바꿔 보여준다", async () => {
    naver();
    process.env.EMAIL_ALLOWED_RECIPIENTS = "*";
    sendMailMock.mockRejectedValue(new Error("Invalid login: 535 Authentication failed"));
    const { deliver } = await import("@/lib/mailer");
    const r = await deliver("a@example.com", { subject: "s", body: "b" });
    expect(r.status).toBe("failed");
    expect(r.detail).toMatch(/앱 비밀번호/);
  });

  it("587 포트는 STARTTLS(secure=false)", async () => {
    naver();
    process.env.SMTP_PORT = "587";
    const { sendMail } = await import("@/lib/mailer");
    sendMailMock.mockResolvedValue({ messageId: "x" });
    await sendMail("a@example.com", { subject: "s", body: "b" });
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false }));
  });
});

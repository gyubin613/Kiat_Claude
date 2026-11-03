import { z } from "zod";
import { adminPassword, checkPassword, createSession, SESSION_COOKIE } from "@/lib/auth";
import { body, handle, json } from "@/lib/api";

export const POST = handle(async (req: Request) => {
  if (!adminPassword()) return json({ error: "관리자 비밀번호(ADMIN_PASSWORD)가 서버에 설정되지 않았습니다." }, 503);
  const { password } = await body(req, z.object({ password: z.string().max(200) }));
  if (!(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 600)); // 무차별 대입 지연
    return json({ error: "비밀번호가 올바르지 않습니다." }, 401);
  }
  const s = await createSession();
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: s.maxAge,
  });
  return res;
});

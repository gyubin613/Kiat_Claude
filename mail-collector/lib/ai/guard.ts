// 시제품을 외부에 배포했을 때 AI 호출이 남용되지 않도록 하는 간단한 잠금
export function checkAccess(req: Request): Response | null {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  if (req.headers.get("x-app-password") === pw) return null;
  return Response.json({ error: "접속 비밀번호가 필요합니다." }, { status: 401 });
}

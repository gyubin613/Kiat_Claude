import { json } from "@/lib/api";
import { cronBaseUrl, runAllFollowups } from "@/lib/followup";

export const dynamic = "force-dynamic";

/**
 * 무응답 자동 후속 안내 점검 (스케줄러 호출용)
 * - Vercel Cron: CRON_SECRET 설정 시 Authorization: Bearer <CRON_SECRET> 헤더를 자동으로 붙여 호출
 * - GitHub Actions(매시간): 같은 헤더로 호출
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "CRON_SECRET이 설정되지 않았습니다." }, 503);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "인증 실패" }, 401);
  const results = await runAllFollowups(cronBaseUrl(new URL(req.url).origin));
  return json({ ok: true, at: new Date().toISOString(), results });
}

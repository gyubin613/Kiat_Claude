import { AI_SCHEMA, AI_SYSTEM, buildUserPrompt, sanitizeAiResult, type AiClassifyRequest } from "@/lib/ai/classify";
import { checkAccess } from "@/lib/ai/guard";
import { aiConfig, completeJson } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  if (aiConfig().provider === "none") {
    return Response.json({ error: "AI가 설정되지 않았습니다." }, { status: 503 });
  }
  let body: AiClassifyRequest;
  try {
    body = (await req.json()) as AiClassifyRequest;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!body?.mail || !Array.isArray(body.candidates) || !Array.isArray(body.docTypes)) {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  // 보내는 양 제한: 본문 6천 자, 후보 80개, 첨부 30개
  const safe: AiClassifyRequest = {
    mail: {
      subject: String(body.mail.subject ?? "").slice(0, 300),
      fromName: String(body.mail.fromName ?? "").slice(0, 120),
      fromAddress: String(body.mail.fromAddress ?? "").slice(0, 200),
      date: String(body.mail.date ?? "").slice(0, 40),
      body: String(body.mail.body ?? "").slice(0, 6000),
      attachments: (body.mail.attachments ?? []).slice(0, 30).map((a) => String(a).slice(0, 200)),
    },
    candidates: body.candidates.slice(0, 80).map((c) => ({
      id: String(c.id).slice(0, 40),
      name: String(c.name ?? "").slice(0, 200),
      leadOrg: String(c.leadOrg ?? "").slice(0, 100),
      partnerOrg: String(c.partnerOrg ?? "").slice(0, 120),
      country: String(c.country ?? "").slice(0, 40),
    })),
    docTypes: body.docTypes.slice(0, 20).map((d) => String(d).slice(0, 30)),
  };
  try {
    const raw = await completeJson({ system: AI_SYSTEM, user: buildUserPrompt(safe), schema: AI_SCHEMA as unknown as Record<string, unknown> });
    return Response.json(sanitizeAiResult(raw, safe));
  } catch (e) {
    return Response.json({ error: `AI 판단에 실패했습니다: ${(e as Error).message}` }, { status: 502 });
  }
}

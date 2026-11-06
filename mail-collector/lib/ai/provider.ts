// AI 호출부를 한곳에 모은다.
// 시제품은 Claude API, 기관 내부 이관 시에는 내부 서버의 OpenAI 호환 모델 서버(vLLM·Ollama 등)로
// 환경변수만 바꿔 전환한다. 화면·매칭 코드는 이 파일 밖의 내용을 바꿀 필요가 없다.
import Anthropic from "@anthropic-ai/sdk";

export type ProviderName = "anthropic" | "internal" | "none";

export interface AiConfig {
  provider: ProviderName;
  model: string;
  /** 화면 표시용 설명 */
  label: string;
}

export function aiConfig(): AiConfig {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if ((forced === "internal" || (!forced && process.env.AI_BASE_URL)) && process.env.AI_BASE_URL) {
    const model = process.env.AI_MODEL || "local-model";
    return { provider: "internal", model, label: `내부 모델 서버 (${model})` };
  }
  if ((forced === "anthropic" || !forced) && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.AI_MODEL || "claude-sonnet-5-5";
    return { provider: "anthropic", model, label: `Claude API (${model})` };
  }
  return { provider: "none", model: "", label: "AI 미설정 (규칙 기반만 사용)" };
}

export interface JsonRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new Error("AI 응답에서 JSON을 찾지 못했습니다.");
  }
}

export async function completeJson(req: JsonRequest): Promise<unknown> {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error("AI가 설정되지 않았습니다.");

  if (cfg.provider === "anthropic") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: cfg.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: { format: { type: "json_schema", schema: req.schema } },
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return extractJson(text);
  }

  // 내부 모델 서버: OpenAI 호환 /v1/chat/completions
  const base = process.env.AI_BASE_URL!.replace(/\/+$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.AI_API_KEY ? { Authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${req.system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 하나만 출력하세요:\n${JSON.stringify(req.schema)}` },
        { role: "user", content: req.user },
      ],
    }),
  });
  if (!r.ok) throw new Error(`내부 모델 서버 오류 (${r.status})`);
  const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

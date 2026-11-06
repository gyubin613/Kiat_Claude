import { aiConfig } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export function GET() {
  const cfg = aiConfig();
  return Response.json({
    enabled: cfg.provider !== "none",
    provider: cfg.provider,
    label: cfg.label,
    passwordRequired: !!process.env.APP_PASSWORD,
  });
}

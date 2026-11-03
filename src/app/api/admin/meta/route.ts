import { json } from "@/lib/api";
import { usingDevPassword } from "@/lib/auth";
import { emailServiceStatus } from "@/lib/email";
import { kv } from "@/lib/store";
import { listEvaluators } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const email = emailServiceStatus();
  return json({
    storage: kv().kind,
    devPassword: usingDevPassword(),
    evaluatorCount: (await listEvaluators()).length,
    email: { configured: email.configured, from: email.from, allowList: email.allowList },
  });
}

import { json } from "@/lib/api";
import { usingDevPassword } from "@/lib/auth";
import { emailServiceStatus } from "@/lib/mailer";
import { kv } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const email = emailServiceStatus();
  return json({
    storage: kv().kind,
    devPassword: usingDevPassword(),
    email: {
      configured: email.configured,
      provider: email.provider,
      from: email.from,
      fromName: email.fromName,
      replyTo: email.replyTo,
      allowList: email.allowList,
      allowAll: email.allowAll,
      notify: process.env.ADMIN_NOTIFY_EMAIL || null,
    },
    cron: Boolean(process.env.CRON_SECRET),
  });
}

import { z } from "zod";
import { body, handle, json } from "@/lib/api";
import { resetAll } from "@/lib/repo";
import { seedDemoData } from "@/lib/seed";

/** 시연용 가상 데이터 불러오기 / 전체 초기화 */
export const POST = handle(async (req: Request) => {
  const { action } = await body(req, z.object({ action: z.enum(["seed", "reset"]) }));
  if (action === "reset") {
    await resetAll();
    return json({ ok: true });
  }
  return json({ ok: true, ...(await seedDemoData()) });
});

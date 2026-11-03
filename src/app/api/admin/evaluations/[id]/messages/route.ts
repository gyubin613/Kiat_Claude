import { handle, json } from "@/lib/api";
import { listAnnouncements, listThreads } from "@/lib/comm";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const [threads, announcements] = await Promise.all([listThreads(id), listAnnouncements(id)]);
  return json({ threads, announcements });
});

import { baseUrl, body, handle, json } from "@/lib/api";
import { createAnnouncement } from "@/lib/comm";
import { announcementInput } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await body(req, announcementInput);
  return json(await createAnnouncement(id, input, baseUrl(req)), 201);
});

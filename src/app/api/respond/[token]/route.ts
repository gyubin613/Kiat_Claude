import { body, handle, json } from "@/lib/api";
import { resolveToken, submitResponse } from "@/lib/repo";
import { getThread, listAnnouncements, markReadByEvaluator } from "@/lib/comm";
import { responseInput } from "@/lib/validate";

type Ctx = { params: Promise<{ token: string }> };
export const dynamic = "force-dynamic";

/** 평가위원 회신 화면에 필요한 최소 정보만 반환 (다른 위원 정보·관리자 메모 비공개) */
async function view(token: string, markRead = false) {
  const { evaluation: e, evaluator: v, invite: inv } = await resolveToken(token);
  const fin = e.finalization;
  const [thread, announcements] = await Promise.all([getThread(e.id, v.id), listAnnouncements(e.id)]);
  // 화면에는 '새 답변' 수를 보여준 뒤 읽음 처리
  if (markRead && thread?.unreadEvaluator) await markReadByEvaluator(e.id, v.id);
  return {
    evaluation: {
      name: e.name,
      department: e.department,
      contactName: e.contactName,
      deadline: e.deadline,
      requirements: e.requirements,
      slots: e.slots,
      finalized: e.status === "finalized",
    },
    evaluator: { name: v.name, org: v.org },
    invite: { status: inv.status, response: inv.response },
    // 본인 대화와 본인에게 보낸 안내만 공개 (메일 발송 결과 등 내부 정보 제외)
    messages: (thread?.messages ?? []).map((m) => ({ id: m.id, from: m.from, body: m.body, at: m.at })),
    unread: thread?.unreadEvaluator ?? 0,
    announcements: announcements
      .filter((a) => a.recipientIds.includes(v.id))
      .map((a) => ({ id: a.id, title: a.title, body: a.body, at: a.at })),
    result: fin
      ? { slot: fin.slot, selected: fin.members.some((m) => m.evaluatorId === v.id) }
      : null,
  };
}

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { token } = await params;
  return json(await view(token, true));
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params;
  const input = await body(req, responseInput);
  await submitResponse(token, input);
  return json(await view(token));
});

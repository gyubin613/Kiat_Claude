import { body, handle, json } from "@/lib/api";
import { resolveToken, submitResponse } from "@/lib/repo";
import { responseInput } from "@/lib/validate";

type Ctx = { params: Promise<{ token: string }> };
export const dynamic = "force-dynamic";

/** 평가위원 회신 화면에 필요한 최소 정보만 반환 (다른 위원 정보·관리자 메모 비공개) */
async function view(token: string) {
  const { evaluation: e, evaluator: v, invite: inv } = await resolveToken(token);
  const fin = e.finalization;
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
    result: fin
      ? { slot: fin.slot, selected: fin.members.some((m) => m.evaluatorId === v.id) }
      : null,
  };
}

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { token } = await params;
  return json(await view(token));
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { token } = await params;
  const input = await body(req, responseInput);
  await submitResponse(token, input);
  return json(await view(token));
});

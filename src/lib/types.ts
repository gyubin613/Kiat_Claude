// 도메인 타입 정의
// 평가위원 기본정보(Evaluator)와 평가별 운영정보(Invite, Finalization)를 분리하여 관리한다.

export type Slot = {
  id: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  place: string;
};

export type EmailTemplate = {
  subject: string;
  body: string;
};

export type FinalizedMember = {
  evaluatorId: string;
  // 확정 시점의 성명·소속 스냅샷 (이후 기본정보가 정정되어도 확정 결과는 유지)
  name: string;
  org: string;
  attendance: Attendance;
};

export type Finalization = {
  slotId: string;
  slot: Slot; // 확정 시점 스냅샷
  members: FinalizedMember[];
  finalizedAt: string;
  memo: string;
};

export type EvaluationStatus = "draft" | "inviting" | "finalized";

export type Evaluation = {
  id: string;
  name: string;
  department: string;
  contactName: string;
  deadline: string; // 회신 기한 YYYY-MM-DD
  seats: number; // 평가위원 배석 인원
  requirements: string; // 참여 요청사항
  slots: Slot[];
  historyWeight: number; // 0~100, 우선순위 산출 시 과거 이력 가중치 (나머지는 관리자 선호도)
  emailTemplate: EmailTemplate;
  status: EvaluationStatus;
  finalization: Finalization | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Evaluator = {
  id: string;
  name: string;
  org: string;
  email: string;
  phone: string;
  expertise: string;
  pastInvited: number | null;
  pastAttended: number | null;
  preference: number | null; // 1~5
  note: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Attendance = "yes" | "conditional" | "no";

export type InviteResponse = {
  attendance: Attendance;
  slotIds: string[];
  note: string;
  submittedAt: string;
  updatedAt: string;
  revision: number;
};

export type InviteStatus = "pending" | "sent" | "withdrawn";

export type Invite = {
  evaluationId: string;
  evaluatorId: string;
  token: string;
  status: InviteStatus;
  round: number; // 섭외 차수 (1차, 2차 후순위 ...)
  sentAt: string | null;
  sentVia: "manual" | "email" | null;
  withdrawnReason: string;
  response: InviteResponse | null;
  log: { at: string; action: string }[]; // 발송·회신·철회 이력 (최근 30건)
  createdAt: string;
  updatedAt: string;
  version: number;
};

/** 관리자 화면 표시용 상태 */
export type InviteDisplayState =
  | "not_sent"
  | "waiting"
  | "yes"
  | "conditional"
  | "no"
  | "withdrawn";

export function inviteDisplayState(inv: Invite): InviteDisplayState {
  if (inv.status === "withdrawn") return "withdrawn";
  if (inv.response) return inv.response.attendance;
  if (inv.status === "sent") return "waiting";
  return "not_sent";
}

export const DISPLAY_STATE_LABEL: Record<InviteDisplayState, string> = {
  not_sent: "미발송",
  waiting: "회신 대기",
  yes: "참석 가능",
  conditional: "조건부 가능",
  no: "참석 불가",
  withdrawn: "섭외 철회",
};

export const ATTENDANCE_LABEL: Record<Attendance, string> = {
  yes: "참석 가능",
  conditional: "조건부 참석 가능",
  no: "참석 불가",
};

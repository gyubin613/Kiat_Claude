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

/** 무응답 자동 후속 안내 설정 (평가별) */
export type FollowupSettings = {
  enabled: boolean;
  hours: number; // 초청 발송 후 이 시간 안에 회신이 없으면 다음 순위 위원에게 안내
  onDecline: boolean; // '참석 불가' 회신 시에도 다음 순위 위원에게 자동 안내
  autoSend: boolean; // 이메일 발송 서비스가 설정된 경우 자동 발송 (아니면 초청 대상만 추가)
};

export const DEFAULT_FOLLOWUP: FollowupSettings = { enabled: false, hours: 48, onDecline: false, autoSend: true };

export function followupOf(e: Pick<Evaluation, "followup">): FollowupSettings {
  return { ...DEFAULT_FOLLOWUP, ...(e.followup ?? {}) };
}

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
  followup?: FollowupSettings; // 이전 데이터 호환을 위해 선택 항목 (followupOf()로 읽기)
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
  escalatedAt?: string | null; // 무응답·불참으로 다음 순위 자동 안내가 처리된 시각
  autoInvited?: boolean; // 자동 후속 안내로 추가된 초청
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

// ---------------- 위원 소통 ----------------

export type MailResult = { status: "sent" | "failed" | "skipped"; detail?: string };

export type Message = {
  id: string;
  from: "evaluator" | "admin";
  body: string;
  at: string;
  email?: MailResult; // 관리자 답변의 메일 발송 결과
};

/** 평가 × 위원 1:1 문의 스레드 */
export type Thread = {
  evaluationId: string;
  evaluatorId: string;
  messages: Message[];
  unreadAdmin: number; // 관리자가 읽지 않은 위원 메시지 수
  unreadEvaluator: number; // 위원이 읽지 않은 관리자 메시지 수
  lastAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type AnnouncementAudience = "all" | "waiting" | "attending";

export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  all: "초청 위원 전체",
  waiting: "회신 대기 위원",
  attending: "참석 가능 회신 위원",
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  recipientIds: string[];
  at: string;
  sendEmail: boolean;
  result: { sent: number; failed: number; skipped: number };
};

export type AnnouncementDoc = { items: Announcement[]; createdAt: string; updatedAt: string; version: number };

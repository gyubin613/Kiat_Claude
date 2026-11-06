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

/** 섭외 우선순위 가중치 (각 0~100, 합으로 나누어 비율 적용) */
export type Weights = { history: number; preference: number; overseas: number };

export function weightsOf(e: Pick<Evaluation, "weights" | "historyWeight">): Weights {
  if (e.weights) return e.weights;
  const h = e.historyWeight ?? 50;
  return { history: h, preference: 100 - h, overseas: 0 };
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
  historyWeight: number; // (이전 버전 호환) 과거 이력 가중치 — weightsOf()로 읽기
  weights?: Weights;
  conflictKeywords?: string[]; // 이해관계 확인용 피평가 기관명 등 (가중치 미반영)
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
  // 학력 (이해관계 확인용 표시 + 해외 대학 여부는 해외경험 점수에 반영)
  bachelorSchool: string;
  bachelorMajor: string;
  bachelorAbroad: boolean | null; // null = 미입력
  finalDegree: Degree;
  finalSchool: string;
  finalMajor: string;
  finalAbroad: boolean | null;
  // 해외 근무 경력
  overseasWorkYears: number | null; // null = 미입력, 0 = 없음
  overseasWorkDetail: string;
  evaluationId?: string; // 소속 평가 (이전 버전 공통 명단은 없음)
  createdAt: string;
  updatedAt: string;
  version: number;
};

export const DEGREES = ["", "학사", "석사", "박사"] as const;
export type Degree = (typeof DEGREES)[number];

export const EDUCATION_DEFAULTS = {
  bachelorSchool: "",
  bachelorMajor: "",
  bachelorAbroad: null,
  finalDegree: "",
  finalSchool: "",
  finalMajor: "",
  finalAbroad: null,
  overseasWorkYears: null,
  overseasWorkDetail: "",
} satisfies Partial<Evaluator>;

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
  conditionReview?: ConditionReview | null; // 조건부 참석에 대한 관리자 검토 (회신이 수정되면 초기화)
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ConditionReview = { decision: "accepted" | "rejected"; note: string; at: string };

/** 조건부 회신이 확정 후보가 될 수 있는지: 관리자가 '수락'한 경우만 */
export function conditionAccepted(inv: Pick<Invite, "response" | "conditionReview">) {
  return inv.response?.attendance === "conditional" && inv.conditionReview?.decision === "accepted";
}

/** 관리자 화면 표시용 상태 */
export type InviteDisplayState =
  | "not_sent"
  | "waiting"
  | "yes"
  | "conditional"
  | "cond_accepted"
  | "cond_rejected"
  | "no"
  | "withdrawn";

export function inviteDisplayState(inv: Invite): InviteDisplayState {
  if (inv.status === "withdrawn") return "withdrawn";
  if (inv.response?.attendance === "conditional" && inv.conditionReview)
    return inv.conditionReview.decision === "accepted" ? "cond_accepted" : "cond_rejected";
  if (inv.response) return inv.response.attendance;
  if (inv.status === "sent") return "waiting";
  return "not_sent";
}

export const DISPLAY_STATE_LABEL: Record<InviteDisplayState, string> = {
  not_sent: "미발송",
  waiting: "회신 대기",
  yes: "참석 가능",
  conditional: "조건부 · 답변 필요",
  cond_accepted: "조건부 · 수락",
  cond_rejected: "조건부 · 거절",
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
  kind?: "question" | "condition"; // question: 관리자 확인 요청 / condition: 위원의 조건부 참석 문의
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
  askReply?: boolean;
  result: { sent: number; failed: number; skipped: number };
};

export type AnnouncementDoc = { items: Announcement[]; createdAt: string; updatedAt: string; version: number };

/** 관리자 확인 요청 중 위원이 아직 답하지 않은 것이 있는지 (마지막 확인 요청 이후 위원 메시지가 없으면 대기) */
export function pendingQuestion(t: Pick<Thread, "messages"> | null | undefined): Message | null {
  if (!t) return null;
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const m = t.messages[i];
    if (m.from === "evaluator") return null;
    if (m.kind === "question") return m;
  }
  return null;
}

/** 위원 문의 중 관리자가 아직 답하지 않은 것이 있는지 */
export function unansweredInquiry(t: Pick<Thread, "messages"> | null | undefined) {
  const last = t?.messages.at(-1);
  return last?.from === "evaluator";
}

export const STATE_CLASS: Record<InviteDisplayState, string> = {
  not_sent: "",
  waiting: "info",
  yes: "ok",
  conditional: "warn",
  cond_accepted: "ok",
  cond_rejected: "bad",
  no: "bad",
  withdrawn: "bad",
};

import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식(YYYY-MM-DD)이 올바르지 않습니다.");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "시간 형식(HH:MM)이 올바르지 않습니다.");
const text = (max: number) => z.string().trim().max(max, `${max}자 이내로 입력해 주세요.`);

export const slotInput = z
  .object({
    id: z.string().max(40).optional(),
    date,
    start: time,
    end: z.union([time, z.literal("")]).default(""),
    place: text(100).default(""),
  })
  .refine((s) => !s.end || s.end > s.start, { message: "종료 시간은 시작 시간 이후여야 합니다.", path: ["end"] });

const weightsSchema = z.object({
  history: z.coerce.number().min(0).max(100),
  preference: z.coerce.number().min(0).max(100),
  overseas: z.coerce.number().min(0).max(100),
});

const evaluationBase = {
  name: text(100).min(1, "평가명을 입력해 주세요."),
  department: text(60),
  contactName: text(40),
  deadline: date,
  seats: z.coerce.number().int().min(1, "배석 인원은 1명 이상이어야 합니다.").max(50),
  requirements: text(2000),
  slots: z.array(slotInput).max(30),
  historyWeight: z.coerce.number().min(0).max(100),
  weights: weightsSchema,
  conflictKeywords: z.array(z.string().trim().min(1).max(60)).max(30),
  recruitMode: z.enum(["manual", "auto"]),
  autoQueue: z.array(z.string().max(40)).max(500),
  autoExcluded: z.array(z.string().max(40)).max(500),
  emailTemplate: z.object({ subject: text(200).min(1, "메일 제목을 입력해 주세요."), body: text(5000).min(1, "메일 본문을 입력해 주세요.") }),
  followup: z.object({
    enabled: z.boolean(),
    hours: z.coerce.number().int().min(1, "1시간 이상으로 설정해 주세요.").max(336, "최대 14일(336시간)까지 설정할 수 있습니다."),
    onDecline: z.boolean(),
    autoSend: z.boolean(),
  }),
};

export const evaluationInput = z.object({
  ...evaluationBase,
  department: evaluationBase.department.default(""),
  contactName: evaluationBase.contactName.default(""),
  requirements: evaluationBase.requirements.default(""),
  slots: evaluationBase.slots.default([]),
  historyWeight: evaluationBase.historyWeight.default(50),
  weights: weightsSchema.optional(),
  conflictKeywords: evaluationBase.conflictKeywords.default([]),
  recruitMode: evaluationBase.recruitMode.default("manual"),
  autoQueue: evaluationBase.autoQueue.optional(),
  autoExcluded: evaluationBase.autoExcluded.optional(),
  emailTemplate: evaluationBase.emailTemplate.optional(),
  followup: evaluationBase.followup.optional(),
});

/** 부분 수정: 기본값을 적용하지 않음 (보내지 않은 항목은 기존 값 유지) */
export const evaluationPatch = z.object(evaluationBase).partial().extend({ version: z.number().int() });

const optionalCount = z
  .union([z.number(), z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "0 이상의 정수를 입력해 주세요." });
      return z.NEVER;
    }
    return n;
  });

const optionalPreference = z
  .union([z.number(), z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      ctx.addIssue({ code: "custom", message: "선호도는 1~5 사이 정수입니다." });
      return z.NEVER;
    }
    return n;
  });

/** Y/N, 예/아니오, 해외/국내, true/false → boolean, 빈칸 → null */
const optionalBool = z
  .union([z.boolean(), z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || typeof v === "boolean") return v;
    const t = v.trim().toLowerCase();
    if (t === "") return null;
    if (["y", "yes", "예", "o", "해외", "true", "1"].includes(t)) return true;
    if (["n", "no", "아니오", "아니요", "x", "국내", "false", "0"].includes(t)) return false;
    ctx.addIssue({ code: "custom", message: "해외 여부는 Y 또는 N으로 입력해 주세요." });
    return z.NEVER;
  });

const optionalYears = z
  .union([z.number(), z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || v === "") return null;
    const n = Number(String(v).replace(/년/g, "").trim());
    if (!Number.isFinite(n) || n < 0 || n > 60) {
      ctx.addIssue({ code: "custom", message: "해외 근무 경력은 0~60 사이 숫자(년)로 입력해 주세요." });
      return z.NEVER;
    }
    return Math.round(n * 10) / 10;
  });

const degree = z
  .union([z.string(), z.null()])
  .transform((v, ctx) => {
    const t = (v ?? "").trim();
    if (t === "") return "" as const;
    if (/박사|ph\.?d|doctor/i.test(t)) return "박사" as const;
    if (/석사|master/i.test(t)) return "석사" as const;
    if (/학사|bachelor/i.test(t)) return "학사" as const;
    ctx.addIssue({ code: "custom", message: "최종학위는 학사·석사·박사 중 하나로 입력해 주세요." });
    return z.NEVER;
  });

const evaluatorBase = {
  name: text(40).min(1, "성명을 입력해 주세요."),
  org: text(100),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "이메일 형식이 올바르지 않습니다."),
  phone: text(40),
  expertise: text(200),
  pastInvited: optionalCount,
  pastAttended: optionalCount,
  preference: optionalPreference,
  note: text(1000),
  bachelorSchool: text(100),
  bachelorMajor: text(100),
  bachelorAbroad: optionalBool,
  finalDegree: degree,
  finalSchool: text(100),
  finalMajor: text(100),
  finalAbroad: optionalBool,
  overseasWorkYears: optionalYears,
  overseasWorkDetail: text(200),
};

export const evaluatorInput = z
  .object({
    ...evaluatorBase,
    org: evaluatorBase.org.default(""),
    email: evaluatorBase.email.default(""),
    phone: evaluatorBase.phone.default(""),
    expertise: evaluatorBase.expertise.default(""),
    pastInvited: evaluatorBase.pastInvited.default(null),
    pastAttended: evaluatorBase.pastAttended.default(null),
    preference: evaluatorBase.preference.default(null),
    note: evaluatorBase.note.default(""),
    bachelorSchool: evaluatorBase.bachelorSchool.default(""),
    bachelorMajor: evaluatorBase.bachelorMajor.default(""),
    bachelorAbroad: evaluatorBase.bachelorAbroad.default(null),
    finalDegree: evaluatorBase.finalDegree.default(""),
    finalSchool: evaluatorBase.finalSchool.default(""),
    finalMajor: evaluatorBase.finalMajor.default(""),
    finalAbroad: evaluatorBase.finalAbroad.default(null),
    overseasWorkYears: evaluatorBase.overseasWorkYears.default(null),
    overseasWorkDetail: evaluatorBase.overseasWorkDetail.default(""),
  })
  .refine((v) => v.pastInvited == null || v.pastAttended == null || v.pastAttended <= v.pastInvited, {
    message: "참여 횟수는 초청 횟수보다 클 수 없습니다.",
    path: ["pastAttended"],
  });

/** 변경된 항목만 전송 — 나머지 값은 기존 값 유지 (기본값 미적용) */
export const evaluatorPatch = z.object(evaluatorBase).partial().extend({ version: z.number().int() });

export const responseInput = z
  .object({
    attendance: z.enum(["yes", "conditional", "no"]),
    slotIds: z.array(z.string().max(40)).max(30).default([]),
    note: text(1000).default(""),
  })
  .refine((v) => v.attendance === "no" || v.slotIds.length > 0, {
    message: "참석 가능한 일정을 1개 이상 선택해 주세요.",
    path: ["slotIds"],
  })
  .refine((v) => v.attendance !== "conditional" || v.note.length > 0, {
    message: "조건부 참석은 참석 조건이나 문의사항을 반드시 적어 주세요. 담당자가 확인 후 답변드립니다.",
    path: ["note"],
  });

export function firstError(err: z.ZodError): string {
  const issue = err.issues[0];
  return issue?.message ?? "입력값을 확인해 주세요.";
}

export const messageInput = z.object({
  body: z.string().trim().min(1, "내용을 입력해 주세요.").max(2000, "2000자 이내로 입력해 주세요."),
});

export const adminMessageInput = messageInput.extend({
  sendEmail: z.boolean().default(true),
  kind: z.enum(["reply", "question"]).default("reply"),
});

export const announcementInput = z.object({
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(120),
  body: z.string().trim().min(1, "내용을 입력해 주세요.").max(5000),
  audience: z.enum(["all", "waiting", "attending"]),
  sendEmail: z.boolean().default(true),
  askReply: z.boolean().default(false),
});

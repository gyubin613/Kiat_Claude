// 위원 학력·해외경험 표시와 이해관계 확인 (서버·브라우저 공용)
import type { Evaluator } from "./types";

type Edu = Pick<
  Evaluator,
  | "bachelorSchool"
  | "bachelorMajor"
  | "bachelorAbroad"
  | "finalDegree"
  | "finalSchool"
  | "finalMajor"
  | "finalAbroad"
  | "overseasWorkYears"
  | "overseasWorkDetail"
>;

const join = (school: string, major: string, abroad: boolean | null) =>
  [school, major && `(${major})`, abroad ? "· 해외" : ""].filter(Boolean).join(" ");

export function bachelorText(v: Partial<Edu>) {
  return v.bachelorSchool ? join(v.bachelorSchool, v.bachelorMajor ?? "", v.bachelorAbroad ?? null) : "";
}

/** 최종학력이 학사이고 학사와 같은 학교라면 생략 */
export function finalText(v: Partial<Edu>) {
  if (!v.finalSchool && !v.finalDegree) return "";
  if (v.finalDegree === "학사" && (!v.finalSchool || v.finalSchool === v.bachelorSchool)) return "";
  return `${v.finalDegree ? `${v.finalDegree} ` : ""}${join(v.finalSchool ?? "", v.finalMajor ?? "", v.finalAbroad ?? null)}`.trim();
}

export function overseasTags(v: Partial<Edu>) {
  const tags: string[] = [];
  if (v.bachelorAbroad || v.finalAbroad) tags.push("해외 대학");
  if (v.overseasWorkYears && v.overseasWorkYears > 0) tags.push(`해외 근무 ${v.overseasWorkYears}년`);
  return tags;
}

export function educationMissing(v: Partial<Edu>) {
  return !v.bachelorSchool && !v.finalSchool;
}

const norm = (s: string) => s.replace(/\s+/g, "").replace(/\(주\)|㈜|주식회사/g, "").toLowerCase();

export type ConflictHit = { field: "소속" | "학사" | "최종학력"; value: string; keyword: string };

/**
 * 이해관계 확인: 평가에 등록한 키워드(피평가 기관명 등)가 위원의 소속·학사·최종학력 학교에 포함되면 표시한다.
 * 자동 판정이 아니라 담당자 확인을 돕는 표시일 뿐이다.
 */
export function conflictHits(v: Pick<Evaluator, "org"> & Partial<Edu>, keywords: string[] | undefined): ConflictHit[] {
  const ks = (keywords ?? []).map((k) => k.trim()).filter((k) => norm(k).length >= 2);
  if (!ks.length) return [];
  const fields: [ConflictHit["field"], string][] = [
    ["소속", v.org ?? ""],
    ["학사", v.bachelorSchool ?? ""],
    ["최종학력", v.finalSchool ?? ""],
  ];
  const hits: ConflictHit[] = [];
  for (const [field, value] of fields) {
    if (!value) continue;
    const nv = norm(value);
    for (const k of ks) {
      const nk = norm(k);
      if (nv.includes(nk) || (nv.length >= 3 && nk.includes(nv))) hits.push({ field, value, keyword: k });
    }
  }
  return hits;
}

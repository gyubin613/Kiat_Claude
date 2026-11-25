// K-PASS에서 내려받은 평가위원 엑셀을 시스템 형식으로 바꾸는 규칙 (서버·테스트 공용, 외부 호출 없음)
//
// 지원 양식
// 1) 위원 검색 양식: K-PASS에서 검색 조건을 정해 내려받는 파일. 머리글이 두 줄(기술분야 아래 1순위·2순위)
//    성명·소속기관·E-Mail·전문분야·기술분야·평가횟수·국제기술협력단평가위원여부 등
// 2) 정보화실 목록: 정보화실에 요청해 받는 파일. 머리글 ECMM_ID, 한 위원이 학력·경력 수만큼 여러 줄
//    학교·전공·학위, 근무처·근무기간, 제재 기간·사유 등 (이메일 없음)
//
// 개인정보 최소 수집: 생년월일·연락처(핸드폰)는 섭외 메일에 필요하지 않아 읽지 않는다.

import type { Degree } from "./types";

export type ImportFormat = "standard" | "kpass-search" | "kpass-it";

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  standard: "시스템 등록 양식",
  "kpass-search": "K-PASS 위원 검색 양식",
  "kpass-it": "K-PASS 정보화실 목록",
};

export const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 위원 검색 양식에만 있는 머리글 */
const SEARCH_MARKERS = ["평가횟수", "국제기술협력단평가위원여부", "최고평가위원여부", "평가위원선정기관구분"];

export function detectFormat(headers: string[]): ImportFormat {
  const hs = headers.map(norm);
  if (hs.includes("ecmm_id")) return "kpass-it";
  if (hs.some((h) => SEARCH_MARKERS.includes(h))) return "kpass-search";
  return "standard";
}

/** K-PASS 양식에서 읽지 않는 개인정보 열 */
export const PRIVATE_HEADERS = ["생년월일", "연락처", "핸드폰", "휴대폰", "전화번호", "주민등록번호"];

// ---------- 해외 기관 추정 ----------

const COUNTRIES = [
  "미국", "일본", "중국", "독일", "영국", "프랑스", "캐나다", "호주", "스위스", "네덜란드", "스웨덴", "싱가포르",
  "이탈리아", "스페인", "벨기에", "오스트리아", "덴마크", "핀란드", "노르웨이", "이스라엘", "인도", "대만", "홍콩",
  "러시아", "뉴질랜드", "아일랜드", "체코", "폴란드", "헝가리", "베트남", "태국", "말레이시아", "인도네시아", "브라질",
  "usa", "u.s.a", "japan", "china", "germany", "france", "canada", "australia", "switzerland", "netherlands",
  "sweden", "singapore", "italy", "spain", "belgium", "austria", "denmark", "finland", "norway", "israel",
  "india", "taiwan", "hong kong", "england", "united kingdom", "u.k.",
];

/** 영문 표기를 쓰는 국내 기관 (해외로 잘못 보지 않도록) */
const DOMESTIC = [
  "korea", "kaist", "postech", "unist", "gist", "dgist", "etri", "kist", "kaeri", "kari", "kier", "kims", "kitech",
  "keti", "kiat", "krict", "kriss", "kigam", "kbsi", "kisti", "seoul", "busan", "daejeon", "pohang", "yonsei", "hanyang",
  "sungkyunkwan", "skku", "snu", "kyung", "chung", "inha", "ajou", "sogang", "ewha", "kookmin", "konkuk",
  "samsung", "lg", "sk", "hyundai", "posco", "hanwha", "doosan", "kt", "naver", "kakao", "(주)", "㈜", "주식회사",
];

/** 해외 대학 약칭·한글 표기 (영문 'University'가 없어도 해외로 보는 이름) */
const FOREIGN_NAMES_KO = [
  "스탠포드", "스탠퍼드", "하버드", "매사추세츠", "버클리", "캘리포니아", "도쿄", "동경", "교토", "오사카", "칭화", "북경", "베이징",
  "퍼듀", "코넬", "프린스턴", "예일", "컬럼비아", "미시간", "일리노이", "위스콘신", "텍사스", "조지아공", "카네기", "펜실베이니아",
  "옥스포드", "옥스퍼드", "케임브리지", "캠브리지", "아헨", "뮌헨", "취리히",
];
const FOREIGN_NAMES_EN = [
  "mit", "caltech", "stanford", "harvard", "berkeley", "ucla", "ucsd", "eth", "epfl", "oxford", "cambridge", "tokyo", "kyoto",
  "osaka", "tohoku", "tsinghua", "peking", "purdue", "cornell", "princeton", "yale", "columbia", "michigan", "illinois",
  "wisconsin", "texas", "georgia tech", "carnegie", "penn state", "upenn", "rwth", "tu munich", "tum",
];

const word = (w: string) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);

const FOREIGN_WORDS = /\b(university|univ\.?|college|institute of technology|polytechnic|universit[äaée]t?|hochschule|[ée]cole|inc\.?|gmbh|ltd\.?|llc|corp\.?|laborator(y|ies))\b/i;

/**
 * 학교·근무처 이름으로 해외 기관인지 추정한다. (담당자 확인용, 확정 판정 아님)
 * - 나라 이름이 들어 있으면 해외
 * - 영문 대학·기업 표기(University, GmbH 등)이면서 국내 기관 표기가 없으면 해외
 * - 그 밖은 국내
 */
export function looksForeign(name: string): boolean {
  const t = name.trim().toLowerCase();
  if (!t) return false;
  if (COUNTRIES.some((c) => t.includes(c))) return true;
  if (FOREIGN_NAMES_KO.some((c) => t.includes(c))) return true;
  if (DOMESTIC.some((d) => word(d).test(t))) return false;
  if (FOREIGN_NAMES_EN.some((c) => word(c).test(t))) return true;
  return FOREIGN_WORDS.test(t);
}

// ---------- 날짜 ----------

/** 2010-03-01, 2010.03.01, 20100301, 2010.03, 2010/3/1, Date → YYYY-MM-DD (월만 있으면 1일) */
export function looseDate(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = v.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{4})[-./년\s]+(\d{1,2})(?:[-./월\s]+(\d{1,2}))?/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${(m[3] ?? "1").padStart(2, "0")}`;
  return null;
}

export function yearsBetween(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? ms / (365.25 * 24 * 3600 * 1000) : 0;
}

// ---------- 정보화실 목록 (한 위원 여러 줄) ----------

export type ItRow = {
  row: number;
  id: string;
  name: string;
  org: string;
  tech: string[];
  sanctionStart: string | null;
  sanctionEnd: string | null;
  sanctionReason: string;
  school: string;
  major: string;
  degree: string;
  workplace: string;
  workStart: string | null;
  workEnd: string | null;
};

export type ItPerson = {
  row: number; // 첫 줄 번호
  name: string;
  org: string;
  techFields: string;
  bachelorSchool: string;
  bachelorMajor: string;
  bachelorAbroad: boolean | null;
  finalDegree: Degree;
  finalSchool: string;
  finalMajor: string;
  finalAbroad: boolean | null;
  overseasWorkYears: number | null;
  overseasWorkDetail: string;
  sanction: string;
  guessedAbroad: boolean; // 해외 여부를 이름으로 추정했는지
};

const DEGREE_RANK: Record<string, number> = { 학사: 1, 석사: 2, 박사: 3 };

function degreeOf(s: string): Degree {
  if (/박사|ph\.?d|doctor/i.test(s)) return "박사";
  if (/석사|master/i.test(s)) return "석사";
  if (/학사|bachelor/i.test(s)) return "학사";
  return "";
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** 제재 기간 중인지 (오늘 기준). 종료일이 비어 있으면 계속 중으로 본다. */
export function activeSanction(start: string | null, end: string | null, today: string) {
  if (!start && !end) return false;
  if (start && start > today) return false;
  if (end && end < today) return false;
  return true;
}

export function groupItRows(rows: ItRow[], today: string): ItPerson[] {
  const groups = new Map<string, ItRow[]>();
  for (const r of rows) {
    const key = r.id || `${norm(r.name)}|${norm(r.org)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out: ItPerson[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    const name = g.find((r) => r.name)?.name ?? "";
    const org = g.find((r) => r.org)?.org ?? "";

    // 학력: 학위별로 묶어 학사 1건, 최고 학위 1건
    const edu = uniq(g.map((r) => [r.school, r.major, r.degree].join("\u0001"))).map((s) => {
      const [school, major, degree] = s.split("\u0001");
      return { school, major, degree: degreeOf(degree) };
    }).filter((e) => e.school || e.degree);
    const bachelor = edu.find((e) => e.degree === "학사");
    const final = [...edu].filter((e) => e.degree).sort((a, b) => DEGREE_RANK[b.degree] - DEGREE_RANK[a.degree])[0];

    // 근무 경력: 해외로 보이는 근무처의 기간 합
    const works = uniq(g.map((r) => [r.workplace, r.workStart ?? "", r.workEnd ?? ""].join("\u0001"))).map((s) => {
      const [place, start, end] = s.split("\u0001");
      return { place, start, end };
    }).filter((w) => w.place);
    const abroadWorks = works.filter((w) => looksForeign(w.place));
    const years = abroadWorks.reduce((sum, w) => sum + (w.start ? yearsBetween(w.start, w.end || today) : 0), 0);

    // 제재: 지금 제재 기간 중인 것만 남긴다 (지난 제재 이력은 보관하지 않음)
    const sanctions = g.filter((r) => activeSanction(r.sanctionStart, r.sanctionEnd, today));
    const sanction = uniq(
      sanctions.map((r) => `${r.sanctionStart ?? ""}~${r.sanctionEnd ?? ""}${r.sanctionReason ? ` ${r.sanctionReason}` : ""}`),
    ).join("; ");

    out.push({
      row: first.row,
      name,
      org,
      techFields: uniq(g.flatMap((r) => r.tech)).join(" / "),
      bachelorSchool: bachelor?.school ?? "",
      bachelorMajor: bachelor?.major ?? "",
      bachelorAbroad: bachelor?.school ? looksForeign(bachelor.school) : null,
      finalDegree: final?.degree ?? "",
      finalSchool: final?.school ?? "",
      finalMajor: final?.major ?? "",
      finalAbroad: final?.school ? looksForeign(final.school) : null,
      overseasWorkYears: works.length ? Math.round(years * 10) / 10 : null,
      overseasWorkDetail: abroadWorks.map((w) => w.place).join(", ").slice(0, 200),
      sanction: sanction.slice(0, 300),
      guessedAbroad: !!(bachelor?.school || final?.school || works.length),
    });
  }
  return out;
}

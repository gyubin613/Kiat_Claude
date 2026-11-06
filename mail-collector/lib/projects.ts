import type { Project } from "./types";

/** 과제 목록 엑셀의 열 이름을 자동으로 인식하기 위한 후보 */
type FieldKey = keyof Omit<Project, "contacts" | "partnerContacts">;

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  id: ["과제번호", "과제 번호", "과제id", "과제코드", "project no", "project id", "project number"],
  name: ["과제명", "과제 명", "과제이름", "project name", "project title", "title"],
  leadOrg: ["주관기관", "주관 기관", "주관기관명", "국내기관", "lead organization", "lead"],
  partnerOrg: ["해외기관", "해외 기관", "해외기관명", "해외참여기관", "공동연구기관", "partner", "partner organization", "foreign partner"],
  country: ["국가", "해외기관국가", "상대국", "country"],
  manager: ["담당자", "담당", "kiat 담당자", "pm", "manager"],
  year: ["연차", "연도", "년도", "협약연도", "year"],
};

const CONTACT_ALIASES = ["이메일", "메일", "email", "e-mail", "연락처", "담당자메일", "주관기관 이메일", "해외기관 이메일"];

function clean(h: string): string {
  return (h || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface HeaderMapping {
  field: Partial<Record<FieldKey, number>>;
  contactColumns: number[];
  /** 해외기관 연락처로 보이는 열 */
  partnerContactColumns: number[];
}

/** 첫 행(머리글)에서 각 열의 의미를 추정 */
export function detectHeaders(headers: string[]): HeaderMapping {
  const field: HeaderMapping["field"] = {};
  const contactColumns: number[] = [];
  const partnerContactColumns: number[] = [];
  headers.forEach((raw, idx) => {
    const h = clean(raw);
    if (!h) return;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof HeaderMapping["field"], string[]][]) {
      if (field[key] !== undefined) continue;
      if (aliases.some((a) => h === a || h.replace(/\s/g, "") === a.replace(/\s/g, ""))) {
        field[key] = idx;
        return;
      }
    }
    if (CONTACT_ALIASES.some((a) => h.includes(a))) {
      contactColumns.push(idx);
      if (/해외|partner|foreign|overseas/.test(h)) partnerContactColumns.push(idx);
    }
  });
  return { field, contactColumns, partnerContactColumns };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** 머리글 + 데이터 행(문자열 2차원 배열) → 과제 목록 */
export function rowsToProjects(rows: string[][]): { projects: Project[]; warnings: string[] } {
  const warnings: string[] = [];
  if (rows.length < 2) return { projects: [], warnings: ["과제 목록에 데이터 행이 없습니다."] };
  const headerRowIdx = rows.findIndex((r) => {
    const m = detectHeaders(r);
    return m.field.id !== undefined && m.field.name !== undefined;
  });
  if (headerRowIdx < 0) {
    return { projects: [], warnings: ["'과제번호'와 '과제명' 열을 찾지 못했습니다. 첫 행에 열 이름이 있는지 확인해 주세요."] };
  }
  const map = detectHeaders(rows[headerRowIdx]);
  const get = (r: string[], k: keyof HeaderMapping["field"]) => {
    const i = map.field[k];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };
  const seen = new Set<string>();
  const projects: Project[] = [];
  for (const r of rows.slice(headerRowIdx + 1)) {
    const id = get(r, "id");
    if (!id) continue;
    if (seen.has(id)) {
      warnings.push(`과제번호 ${id}가 중복되어 첫 번째 행만 사용했습니다.`);
      continue;
    }
    seen.add(id);
    const contacts = new Set<string>();
    const partnerContacts = new Set<string>();
    const scan = map.contactColumns.length ? map.contactColumns : r.map((_, i) => i);
    for (const i of scan) {
      const v = String(r[i] ?? "");
      for (const m of v.match(EMAIL_RE) ?? []) {
        contacts.add(m.toLowerCase());
        if (map.partnerContactColumns.includes(i)) partnerContacts.add(m.toLowerCase());
      }
    }
    projects.push({
      id,
      name: get(r, "name"),
      leadOrg: get(r, "leadOrg"),
      partnerOrg: get(r, "partnerOrg"),
      country: get(r, "country"),
      manager: get(r, "manager"),
      year: get(r, "year"),
      contacts: [...contacts],
      partnerContacts: [...partnerContacts],
    });
  }
  if (!map.contactColumns.length) {
    warnings.push("이메일 열을 찾지 못해 모든 칸에서 메일 주소를 찾았습니다.");
  }
  return { projects, warnings };
}

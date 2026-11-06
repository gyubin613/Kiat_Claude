import { emailDomain, extOf, kstDateTime, safeFileName, ymd } from "./text";
import type { MailResult, ParsedMail, Project, Settings } from "./types";

export const UNMATCHED_FOLDER = "00_미분류";
export const REVIEW_FOLDER = "01_확인필요";
export const MAIL_ARCHIVE_FOLDER = "_메일원문";

export interface PlannedFile {
  mailId: string;
  /** 첨부 순번. 메일 원문(.eml)이면 -1 */
  attachmentIndex: number;
  projectId: string | null;
  docType: string;
  originalName: string;
  standardName: string;
  /** 최상위 폴더 아래 상대 경로 */
  path: string;
  size: number;
  receivedAt: string;
}

/** 파일명에 넣을 짧은 기관명: "(주)한빛로보틱스" → "한빛로보틱스", "Nordlicht Institute of Technology" → "Nordlicht Institute" */
export function shortOrg(org: string, max = 20): string {
  let s = (org || "").replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|재단법인|사단법인/g, "").trim();
  if (/[가-힣]/.test(s)) return safeFileName(s.replace(/\s+/g, ""), max);
  const words = s.replace(/[,.]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["of", "for", "and", "the", "inc", "ltd", "gmbh", "co", "corp"]);
  let out = "";
  for (const w of words) {
    if (stop.has(w.toLowerCase())) break;
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return safeFileName(out || words[0] || s, max);
}

export function projectFolderName(p: Project): string {
  return safeFileName(`${p.id}_${p.name}`, 50);
}

/** 발신자가 어느 쪽 기관인지 (해외기관 / 주관기관 / 알 수 없음) */
export function senderOrg(mail: ParsedMail, p: Project | undefined): string {
  if (!p) return mail.fromName || emailDomain(mail.fromAddress);
  const from = mail.fromAddress.toLowerCase();
  const d = emailDomain(from);
  const partnerDomains = new Set(p.partnerContacts.map(emailDomain));
  const leadContacts = p.contacts.filter((c) => !p.partnerContacts.includes(c));
  const leadDomains = new Set(leadContacts.map(emailDomain));
  if (p.partnerContacts.includes(from) || (d && partnerDomains.has(d))) return p.partnerOrg || "해외기관";
  if (leadContacts.includes(from) || (d && leadDomains.has(d))) return p.leadOrg || "주관기관";
  return mail.fromName || d || "발신기관 미상";
}

/** 과제·서류 종류 기준으로 파일 이름과 폴더 위치를 정한다 */
export function planFiles(
  mails: ParsedMail[],
  results: MailResult[],
  projects: Project[],
): PlannedFile[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const resultById = new Map(results.map((r) => [r.mailId, r]));
  const used = new Set<string>();
  const unique = (path: string) => {
    if (!used.has(path)) {
      used.add(path);
      return path;
    }
    const dot = path.lastIndexOf(".");
    const base = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
    const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
    let n = 2;
    while (used.has(`${base}_${n}${ext}`)) n += 1;
    const p = `${base}_${n}${ext}`;
    used.add(p);
    return p;
  };

  const out: PlannedFile[] = [];
  for (const mail of mails) {
    const r = resultById.get(mail.id);
    if (!r || r.status === "excluded") continue;
    const settled = r.status === "auto" || r.status === "confirmed";
    const project = settled && r.projectId ? byId.get(r.projectId) : undefined;
    const folder = project ? projectFolderName(project) : r.status === "review" ? REVIEW_FOLDER : UNMATCHED_FOLDER;
    const date = ymd(mail.date);
    const org = shortOrg(senderOrg(mail, project));

    mail.attachments.forEach((a, i) => {
      const docType = r.attachments[i]?.docType || "기타";
      const ext = extOf(a.filename);
      const origStem = safeFileName(a.filename.replace(/\.[^.]+$/, ""), 30);
      const stem = project
        ? `${project.id}_${org}_${docType}_${date}_${origStem}`
        : `${date}_${safeFileName(mail.fromAddress, 40)}_${safeFileName(a.filename.replace(/\.[^.]+$/, ""), 40)}`;
      const standardName = `${safeFileName(stem, 90)}${ext ? "." + ext : ""}`;
      const path = unique(project ? `${folder}/${docType}/${standardName}` : `${folder}/${standardName}`);
      out.push({
        mailId: mail.id,
        attachmentIndex: i,
        projectId: project?.id ?? null,
        docType,
        originalName: a.filename,
        standardName: path.split("/").pop()!,
        path,
        size: a.size,
        receivedAt: mail.date,
      });
    });

    const emlName = `${date}_${mail.id}_${safeFileName(mail.subject, 40)}.eml`;
    const emlPath = unique(`${folder}/${MAIL_ARCHIVE_FOLDER}/${emlName}`);
    out.push({
      mailId: mail.id,
      attachmentIndex: -1,
      projectId: project?.id ?? null,
      docType: "메일원문",
      originalName: mail.sourceName,
      standardName: emlPath.split("/").pop()!,
      path: emlPath,
      size: mail.raw.byteLength,
      receivedAt: mail.date,
    });
  }
  return out;
}

export type DocState = { receivedAt: string; count: number };

export interface ProjectStatusRow {
  project: Project;
  docs: Record<string, DocState | null>;
  missing: string[];
  extraCount: number;
  lastReceived: string;
  state: "완료" | "일부 제출" | "미제출";
}

/** 과제별 서류 제출 현황 */
export function projectStatus(
  mails: ParsedMail[],
  results: MailResult[],
  projects: Project[],
  settings: Settings,
): ProjectStatusRow[] {
  const mailById = new Map(mails.map((m) => [m.id, m]));
  return projects.map((p) => {
    const docs: Record<string, DocState | null> = {};
    for (const d of settings.requiredDocs) docs[d] = null;
    let extraCount = 0;
    let lastReceived = "";
    for (const r of results) {
      if (r.projectId !== p.id || (r.status !== "auto" && r.status !== "confirmed")) continue;
      const m = mailById.get(r.mailId);
      if (!m) continue;
      if (m.date > lastReceived) lastReceived = m.date;
      for (const a of r.attachments) {
        if (a.docType in docs) {
          const cur = docs[a.docType];
          docs[a.docType] = {
            receivedAt: !cur || m.date > cur.receivedAt ? m.date : cur.receivedAt,
            count: (cur?.count ?? 0) + 1,
          };
        } else {
          extraCount += 1;
        }
      }
    }
    const missing = settings.requiredDocs.filter((d) => !docs[d]);
    const state = missing.length === 0 ? "완료" : missing.length === settings.requiredDocs.length ? "미제출" : "일부 제출";
    return { project: p, docs, missing, extraCount, lastReceived, state };
  });
}

export const STATUS_LABEL: Record<MailResult["status"], string> = {
  auto: "자동 분류",
  confirmed: "담당자 확인",
  review: "확인 필요",
  unmatched: "미분류",
  excluded: "대상 아님",
};

export { kstDateTime };

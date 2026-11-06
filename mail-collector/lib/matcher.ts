import { PUBLIC_MAIL_DOMAINS } from "./settings";
import { compact, emailDomain, nameTokens, normalize, orgTokens } from "./text";
import type {
  AttachmentResult,
  Candidate,
  MailResult,
  MatchStatus,
  ParsedMail,
  Project,
  Settings,
} from "./types";

/** 답장 인용부·서명 아래를 잘라낸 본문 */
export function stripQuoted(text: string): string {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^-{2,}\s*(original message|원본 메시지|forwarded message|전달된 메시지)/i.test(t)) break;
    if (/^(on .+ wrote:|.+ 작성:)$/i.test(t)) break;
    if (/^(from|보낸 사람)\s*:/i.test(t) && out.length > 0) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function bodyPreview(text: string, max = 200): string {
  const s = stripQuoted(text).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** 키워드가 문자열에 있는지. 3글자 이하 영문 약어(LOC, MOU 등)는 단어 단위로만 인정 */
function hasKeyword(normHay: string, compactHay: string, kw: string): boolean {
  const k = normalize(kw);
  if (!k) return false;
  if (/^[a-z0-9]{1,3}$/.test(k)) {
    return normHay.split(" ").includes(k);
  }
  return normHay.includes(k) || compactHay.includes(k.replace(/\s+/g, ""));
}

/** 서류 종류 판단: 가장 구체적인(긴) 키워드가 맞은 종류를 고른다 */
export function classifyDoc(
  text: string,
  settings: Settings,
): { type: string; keyword: string } | null {
  const n = normalize(text);
  const c = n.replace(/\s+/g, "");
  let best: { type: string; keyword: string } | null = null;
  for (const [type, kws] of Object.entries(settings.docKeywords)) {
    for (const kw of kws) {
      if (hasKeyword(n, c, kw) && (!best || normalize(kw).length > normalize(best.keyword).length)) {
        best = { type, keyword: kw };
      }
    }
  }
  return best;
}

export function classifyAttachments(mail: ParsedMail, settings: Settings): AttachmentResult[] {
  const mailLevel = classifyDoc(`${mail.subject}\n${stripQuoted(mail.text).slice(0, 1500)}`, settings);
  return mail.attachments.map((a, index) => {
    const byName = classifyDoc(a.filename.replace(/\.[^.]+$/, ""), settings);
    if (byName) {
      return { index, filename: a.filename, docType: byName.type, docReason: `파일명에 '${byName.keyword}'` };
    }
    if (mailLevel && mail.attachments.length === 1) {
      return { index, filename: a.filename, docType: mailLevel.type, docReason: `메일 제목·본문에 '${mailLevel.keyword}'` };
    }
    return { index, filename: a.filename, docType: "기타", docReason: "서류 종류를 알 수 없음" };
  });
}

interface ScoreIndex {
  contactOwners: Map<string, Set<string>>; // 메일주소 → 과제번호들
  domainOwners: Map<string, Set<string>>; // 도메인 → 과제번호들
}

export function buildIndex(projects: Project[]): ScoreIndex {
  const contactOwners = new Map<string, Set<string>>();
  const domainOwners = new Map<string, Set<string>>();
  for (const p of projects) {
    for (const c of p.contacts) {
      const addr = c.toLowerCase();
      if (!contactOwners.has(addr)) contactOwners.set(addr, new Set());
      contactOwners.get(addr)!.add(p.id);
      const d = emailDomain(addr);
      if (d && !PUBLIC_MAIL_DOMAINS.has(d)) {
        if (!domainOwners.has(d)) domainOwners.set(d, new Set());
        domainOwners.get(d)!.add(p.id);
      }
    }
  }
  return { contactOwners, domainOwners };
}

function orgMatch(org: string, normHay: string, compactHay: string): number {
  if (!org) return 0;
  const full = compact(org);
  if (full.length >= 3 && compactHay.includes(full)) return 35;
  const toks = orgTokens(org);
  if (!toks.length) return 0;
  const found = toks.filter((t) => (/[가-힣]/.test(t) ? compactHay.includes(t) : normHay.split(" ").includes(t)));
  const long = found.some((t) => t.length >= 4);
  if (long && found.length / toks.length >= 0.6) return 25;
  return 0;
}

export function scoreProject(
  p: Project,
  mail: ParsedMail,
  index: ScoreIndex,
): Candidate {
  const reasons: string[] = [];
  let score = 0;
  let strong = false;
  const body = stripQuoted(mail.text).slice(0, 4000);
  const fileNames = mail.attachments.map((a) => a.filename).join(" ");
  const cSubject = compact(mail.subject);
  const cFiles = compact(fileNames);
  const cBody = compact(body);
  const cid = compact(p.id);

  // 1) 과제번호
  if (cid.length >= 4) {
    strong = cSubject.includes(cid) || cFiles.includes(cid) || cBody.includes(cid);
    if (cSubject.includes(cid)) {
      score += 100;
      reasons.push("제목에 과제번호");
    } else if (cFiles.includes(cid)) {
      score += 95;
      reasons.push("첨부파일명에 과제번호");
    } else if (cBody.includes(cid)) {
      score += 90;
      reasons.push("본문에 과제번호");
    }
  }

  // 2) 발신자
  const from = mail.fromAddress.toLowerCase();
  const owners = index.contactOwners.get(from);
  if (owners?.has(p.id)) {
    strong = true;
    score += 60;
    if (owners.size === 1) {
      score += 25;
      reasons.push("발신자가 이 과제의 연락처");
    } else {
      reasons.push(`발신자가 과제 ${owners.size}개의 연락처`);
    }
  } else {
    const d = emailDomain(from);
    const dOwners = d ? index.domainOwners.get(d) : undefined;
    if (dOwners?.has(p.id)) {
      strong = true;
      score += 40;
      if (dOwners.size === 1) {
        score += 15;
        reasons.push(`발신 기관 도메인 일치(@${d})`);
      } else {
        reasons.push(`발신 도메인(@${d})이 과제 ${dOwners.size}개와 관련`);
      }
    }
  }

  // 3) 기관명
  const hay = `${mail.subject}\n${mail.fromName}\n${fileNames}\n${body}`;
  const nHay = normalize(hay);
  const cHay = nHay.replace(/\s+/g, "");
  const orgScore = Math.max(orgMatch(p.partnerOrg, nHay, cHay), orgMatch(p.leadOrg, nHay, cHay));
  if (orgScore) {
    score += orgScore;
    reasons.push(orgScore >= 35 ? "기관명 언급" : "기관명 일부 언급");
  }

  // 4) 과제명
  const toks = nameTokens(p.name);
  if (toks.length >= 2) {
    const found = toks.filter((t) => cHay.includes(t.replace(/\s+/g, "")));
    const ratio = found.length / toks.length;
    if (found.length >= 2 && ratio >= 0.5) {
      const s = Math.round(30 * ratio);
      score += s;
      reasons.push(`과제명 핵심어 ${found.length}/${toks.length}개 일치`);
    }
  }

  return { projectId: p.id, score, reasons, strong };
}

export function matchMail(
  mail: ParsedMail,
  projects: Project[],
  settings: Settings,
  index = buildIndex(projects),
): MailResult {
  const candidates = projects
    .map((p) => scoreProject(p, mail, index))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = candidates[0];
  const second = candidates[1];
  let confidence = top ? Math.min(100, top.score) : 0;
  const reasons = top ? [...top.reasons] : [];

  // 기관명·과제명 언급만 있고 발신자·과제번호 단서가 없으면 자동 확정하지 않는다
  if (top && !top.strong && confidence >= settings.autoThreshold) {
    confidence = settings.autoThreshold - 5;
    reasons.push("발신자가 등록된 연락처가 아님");
  }

  const ambiguous =
    !!top && !!second && second.score >= settings.reviewThreshold && top.score - second.score < 15;
  if (ambiguous) {
    confidence = Math.min(confidence, 70);
    reasons.push(`비슷한 후보 과제 있음(${second.projectId})`);
  }

  // 업무 대상 메일인지 2차 판단
  const attachments = classifyAttachments(mail, settings);
  const kwHay = `${mail.subject} ${mail.attachments.map((a) => a.filename).join(" ")} ${stripQuoted(mail.text).slice(0, 1500)}`;
  const nk = normalize(kwHay);
  const ck = nk.replace(/\s+/g, "");
  const kwHits = settings.relevanceKeywords.filter((k) => hasKeyword(nk, ck, k));
  const docHits = attachments.filter((a) => a.docType !== "기타").length;

  let relevant = true;
  let relevanceReason = "";
  if (confidence >= settings.reviewThreshold) {
    relevanceReason = "과제와 연결됨";
  } else if (docHits > 0) {
    relevanceReason = "제출 서류로 보이는 첨부 있음";
  } else if (mail.attachments.length > 0 && kwHits.length >= 1) {
    relevanceReason = `첨부 + 업무 키워드(${kwHits.slice(0, 3).join(", ")})`;
  } else if (kwHits.length >= 3) {
    relevanceReason = `업무 키워드(${kwHits.slice(0, 3).join(", ")})`;
  } else {
    relevant = false;
    relevanceReason = "과제·서류와 관련된 단서 없음";
  }

  let status: MatchStatus;
  if (!relevant) status = "excluded";
  else if (confidence >= settings.autoThreshold && !ambiguous) status = "auto";
  else if (confidence >= settings.reviewThreshold) status = "review";
  else status = "unmatched";

  return {
    mailId: mail.id,
    relevant,
    relevanceReason,
    projectId: status === "auto" || status === "review" ? top!.projectId : null,
    confidence,
    status,
    reasons,
    candidates,
    attachments,
    summary: bodyPreview(mail.text),
    edited: false,
    aiAssisted: false,
  };
}

export function matchAll(mails: ParsedMail[], projects: Project[], settings: Settings): MailResult[] {
  const index = buildIndex(projects);
  return mails.map((m) => matchMail(m, projects, settings, index));
}

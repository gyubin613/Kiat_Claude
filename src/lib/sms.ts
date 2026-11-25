// 기관 문자(SMS) 발송 화면에 올릴 수신자 목록·문구 만들기 (브라우저·테스트 공용, 외부 호출 없음)
//
// 휴대폰 번호는 시스템에 저장하지 않는다. 담당자 PC의 브라우저에서 K-PASS 파일과 맞춰 바로 파일로 내려준다.
import type { AnnouncementAudience } from "./types";
import { formatDateKo, normalizeKey } from "./util";

/** 기관 문자 발송 화면의 엑셀 양식 머리글 */
export const SMS_HEADERS = ["휴대폰번호 (000-0000-0000) [필수]", "이름 [필수]", "소속 [선택]"] as const;
export const SMS_SHORT_BYTES = 90; // 이보다 길면 장문(LMS)
export const SMS_MAX_BYTES = 2000;

/** 문자 길이(바이트) — 한글 등은 2바이트, 영문·숫자는 1바이트로 센다 */
export function smsBytes(text: string) {
  let n = 0;
  for (const ch of text) n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

/** 휴대폰 번호를 000-0000-0000 형식으로. 휴대폰 번호가 아니면 null */
export function normalizePhone(s: string): string | null {
  let d = s.replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  if (!/^01[016789]\d{7,8}$/.test(d)) return null;
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

export type PhoneEntry = { name: string; org: string; phone: string };

const NAME_H = ["성명", "이름", "위원명", "평가위원명"];
const ORG_H = ["소속기관", "소속", "기관명", "기관"];
const PHONE_H = ["연락처", "핸드폰", "휴대폰", "휴대폰번호", "휴대전화", "전화번호", "h.p", "hp"];

/** 엑셀에서 읽은 표(행 배열)에서 성명·소속·휴대폰 열을 찾아 목록으로 만든다 (머리글은 위 5행 안) */
export function phoneEntriesFromRows(rows: string[][]): PhoneEntry[] {
  const n = (s: string) => normalizeKey(s ?? "");
  for (let h = 0; h < Math.min(5, rows.length); h++) {
    const head = rows[h].map(n);
    const ci = (names: string[]) => head.findIndex((x) => names.some((k) => n(k) === x || x.startsWith(n(k))));
    const name = ci(NAME_H), org = ci(ORG_H), phone = ci(PHONE_H);
    if (name < 0 || phone < 0) continue;
    const out: PhoneEntry[] = [];
    for (const r of rows.slice(h + 1)) {
      const p = normalizePhone(r[phone] ?? "");
      const nm = (r[name] ?? "").trim();
      if (nm && p && nm !== rows[h][name]) out.push({ name: nm, org: org >= 0 ? (r[org] ?? "").trim() : "", phone: p });
    }
    return out;
  }
  return [];
}

export type SmsRecipient = { id: string; name: string; org: string; phone: string };
export type SmsMatch = SmsRecipient & { found: "stored" | "file" | "none" };

const orgKey = (s: string) => normalizeKey(s).replace(/\(주\)|㈜|주식회사/g, "");

/**
 * 수신 위원마다 휴대폰 번호를 정한다: 위원 정보에 있는 번호 → 파일에서 성명·소속이 같은 사람 → 파일에 같은 성명이 한 명뿐이면 그 사람
 */
export function matchPhones(recipients: SmsRecipient[], entries: PhoneEntry[]): SmsMatch[] {
  return recipients.map((r) => {
    const own = normalizePhone(r.phone);
    if (own) return { ...r, phone: own, found: "stored" as const };
    const sameName = entries.filter((e) => normalizeKey(e.name) === normalizeKey(r.name));
    const hit = sameName.find((e) => r.org && orgKey(e.org) === orgKey(r.org)) ?? (sameName.length === 1 ? sameName[0] : null);
    return hit ? { ...r, phone: hit.phone, found: "file" as const } : { ...r, phone: "", found: "none" as const };
  });
}

/** 문자 발송 화면 '수신자 목록'에 붙여넣을 내용 (휴대번호·이름·소속, 탭 구분) */
export function pasteText(list: SmsMatch[]) {
  return list.filter((m) => m.phone).map((m) => [m.phone, m.name, m.org].join("\t")).join("\n");
}

/** 대상별 기본 문구 */
export function smsTemplate(
  e: { name: string; deadline: string; contactName: string },
  audience: AnnouncementAudience,
) {
  const contact = e.contactName ? `\n문의: ${e.contactName}` : "";
  if (audience === "waiting")
    return `[한국산업기술진흥원] 평가위원 참석 회신 요청\n안녕하십니까. 「${e.name}」 평가위원 참석 여부를 여쭙는 메일을 보내드렸습니다. 메일(스팸메일함 포함)의 회신 링크로 ${formatDateKo(e.deadline)}까지 회신 부탁드립니다.${contact}`;
  if (audience === "attending")
    return `[한국산업기술진흥원] 「${e.name}」 평가 관련 안내 메일을 보내드렸습니다. 메일(스팸메일함 포함)을 확인해 주시기 바랍니다.${contact}`;
  return `[한국산업기술진흥원] 「${e.name}」 평가위원 섭외 관련 메일을 보내드렸습니다. 메일(스팸메일함 포함)을 확인해 주시기 바랍니다.${contact}`;
}

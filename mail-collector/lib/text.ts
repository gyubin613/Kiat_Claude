// 문자열 정규화·비교 도구

/** 소문자, 전각→반각, 공백·기호 정리 */
export function normalize(s: string): string {
  return (s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()\[\]{}<>"'`“”‘’·,.:;!?/\\|_\-–—~^*+=#@&%$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 공백까지 모두 없앤 비교용 문자열 */
export function compact(s: string): string {
  return normalize(s).replace(/\s+/g, "");
}

/** 기관명 등에서 비교에 의미 없는 단어 */
const ORG_STOPWORDS = new Set([
  "주식회사",
  "주",
  "유한회사",
  "재단법인",
  "사단법인",
  "co",
  "ltd",
  "inc",
  "corp",
  "corporation",
  "company",
  "gmbh",
  "ag",
  "sa",
  "bv",
  "srl",
  "oy",
  "ab",
  "the",
  "of",
  "and",
  "for",
  "e",
  "v",
]);

/** 기관명 핵심어 (예: "(주)한빛로보틱스" → ["한빛로보틱스"]) */
export function orgTokens(org: string): string[] {
  return normalize(org)
    .split(" ")
    .filter((t) => t.length >= 2 && !ORG_STOPWORDS.has(t));
}

const NAME_STOPWORDS = new Set([
  "기술",
  "개발",
  "기반",
  "위한",
  "및",
  "의",
  "를",
  "을",
  "이용한",
  "활용한",
  "시스템",
  "국제공동연구",
  "공동연구",
  "연구",
]);

/** 과제명 핵심어 */
export function nameTokens(name: string): string[] {
  return normalize(name)
    .split(" ")
    .filter((t) => t.length >= 2 && !NAME_STOPWORDS.has(t));
}

export function emailDomain(address: string): string {
  const at = (address || "").lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1).toLowerCase().trim() : "";
}

/** 파일명에 쓸 수 없는 문자 제거 */
export function safeFileName(s: string, max = 60): string {
  const cleaned = (s || "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
}

export function extOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename || "");
  return m ? m[1].toLowerCase() : "";
}

/** YYYYMMDD (KST) */
export function ymd(iso: string): string {
  if (!iso) return "날짜없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "날짜없음";
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

/** YYYY-MM-DD HH:mm (KST) */
export function kstDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 16).replace("T", " ");
}

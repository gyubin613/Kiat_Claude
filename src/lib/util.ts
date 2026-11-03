export function newId(prefix = ""): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 회신 링크용 추측 불가능한 토큰 (192bit) */
export function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const nowIso = () => new Date().toISOString();

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatDateKo(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}. ${m}. ${d}.(${wd})`;
}

export function formatSlot(s: { date: string; start: string; end: string; place?: string }, withPlace = true) {
  const time = s.end ? `${s.start}~${s.end}` : s.start;
  return `${formatDateKo(s.date)} ${time}${withPlace && s.place ? ` / ${s.place}` : ""}`;
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  // 한국 시간 기준 표기
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
}

/** 오늘(KST) 기준 D-day. 기한이 지나면 음수 */
export function daysUntil(date: string, now = new Date()) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const today = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeKey(s: string) {
  return s.replace(/\s+/g, "").toLowerCase();
}

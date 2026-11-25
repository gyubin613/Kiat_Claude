// 후보 일정 달력 계산 (화면·테스트 공용)
export type SlotDraft = { id?: string; date: string; start: string; end: string; place: string };

/** 오늘(한국 시간) YYYY-MM-DD */
export function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 한 달 달력 칸 (앞뒤 빈칸 포함, 날짜 문자열 또는 null) */
export function monthCells(ym: string): (string | null)[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export const sortSlots = (slots: SlotDraft[]) =>
  [...slots].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.start.localeCompare(b.start));


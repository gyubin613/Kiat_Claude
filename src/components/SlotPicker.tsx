"use client";

import { useMemo, useState } from "react";
import { formatDateKo } from "@/lib/util";

import { monthCells, shiftMonth, sortSlots, todayKst, type SlotDraft } from "@/lib/calendar";

export { sortSlots, todayKst, type SlotDraft };

export const TIME_PRESETS = [
  { key: "am", label: "오전", start: "10:00", end: "12:00" },
  { key: "pm", label: "오후", start: "14:00", end: "17:00" },
  { key: "day", label: "종일", start: "10:00", end: "17:00" },
] as const;
type PresetKey = (typeof TIME_PRESETS)[number]["key"];

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 후보 일정 고르기: 달력에서 날짜를 누르면 추가/해제, 시간은 오전·오후·종일 중 고르고 장소는 한 번만 입력.
 * 세부 시간·장소는 아래 목록에서 일정마다 고칠 수 있다.
 */
export default function SlotPicker({ slots, onChange }: { slots: SlotDraft[]; onChange: (s: SlotDraft[]) => void }) {
  const today = todayKst();
  const [month, setMonth] = useState(() => (slots.find((s) => s.date)?.date ?? today).slice(0, 7));
  const [preset, setPreset] = useState<PresetKey>("day");
  const [direct, setDirect] = useState("");
  const commonPlace = useMemo(() => {
    const places = [...new Set(slots.map((s) => s.place))];
    return places.length === 1 ? places[0] : "";
  }, [slots]);
  const p = TIME_PRESETS.find((x) => x.key === preset)!;
  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    slots.forEach((s) => s.date && m.set(s.date, (m.get(s.date) ?? 0) + 1));
    return m;
  }, [slots]);
  const sorted = sortSlots(slots.filter((s) => s.date));

  const add = (date: string, pre = p) =>
    onChange(sortSlots([...slots.filter((s) => s.date), { date, start: pre.start, end: pre.end, place: commonPlace || slots.at(-1)?.place || "" }]));
  const toggleDate = (date: string) => {
    if (byDate.has(date)) onChange(slots.filter((s) => s.date !== date));
    else add(date);
  };
  const update = (target: SlotDraft, patch: Partial<SlotDraft>) => onChange(slots.map((s) => (s === target ? { ...s, ...patch } : s)));

  return (
    <div className="slot-picker">
      <div className="slot-top">
        <div className="cal-mini" aria-label="후보 일정 달력">
          <div className="row between">
            <button type="button" className="btn sm ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">‹</button>
            <b>{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</b>
            <button type="button" className="btn sm ghost" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달">›</button>
          </div>
          <div className="cal-mini-grid">
            {WEEK.map((w, i) => <span key={w} className={`wd ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>{w}</span>)}
            {monthCells(month).map((d, i) =>
              d ? (
                <button
                  type="button"
                  key={d}
                  className={`day ${byDate.has(d) ? "on" : ""} ${d === today ? "today" : ""} ${i % 7 === 0 ? "sun" : i % 7 === 6 ? "sat" : ""}`}
                  disabled={d < today}
                  onClick={() => toggleDate(d)}
                  aria-pressed={byDate.has(d)}
                  aria-label={`${formatDateKo(d)}${byDate.has(d) ? " (선택됨)" : ""}`}
                >
                  {Number(d.slice(8))}
                </button>
              ) : (
                <span key={`b${i}`} />
              ),
            )}
          </div>
        </div>
        <div className="stack" style={{ gap: 12, flex: 1, minWidth: 220 }}>
          <div className="field">
            <label>새로 고르는 날짜의 시간</label>
            <div className="seg" role="radiogroup" aria-label="시간대">
              {TIME_PRESETS.map((t) => (
                <button type="button" key={t.key} className={preset === t.key ? "on" : ""} role="radio" aria-checked={preset === t.key} onClick={() => setPreset(t.key)}>
                  {t.label} {t.start}~{t.end}
                </button>
              ))}
            </div>
            {sorted.length > 1 && (
              <button type="button" className="btn sm ghost" style={{ justifySelf: "start" }} onClick={() => onChange(slots.map((s) => ({ ...s, start: p.start, end: p.end })))}>
                모든 일정을 {p.label}({p.start}~{p.end})으로 맞추기
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor="common-place">장소 (모든 일정 공통)</label>
            <input
              id="common-place"
              className="input"
              placeholder="예) 본원 3층 대회의실"
              value={commonPlace}
              onChange={(e) => onChange(slots.map((s) => ({ ...s, place: e.target.value })))}
            />
            <span className="hint">일정마다 장소가 다르면 아래 목록에서 따로 고칩니다.</span>
          </div>
          <div className="field">
            <label htmlFor="direct-date">날짜를 직접 입력해 추가</label>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id="direct-date" className="input" type="date" min={today} value={direct} onChange={(e) => setDirect(e.target.value)} aria-label="추가할 날짜" />
              <button
                type="button"
                className="btn"
                disabled={!direct}
                onClick={() => {
                  add(direct);
                  setMonth(direct.slice(0, 7));
                  setDirect("");
                }}
              >
                추가
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="slot-list">
        <div className="row between">
          <b>고른 후보 일정 {sorted.length}건</b>
          <span className="small muted">위원은 이 중 참석 가능한 일정을 모두 고릅니다.</span>
        </div>
        {!sorted.length ? (
          <div className="empty" style={{ padding: 18 }}>달력에서 평가 후보 날짜를 눌러 주세요. 여러 날짜를 고를 수 있습니다.</div>
        ) : (
          sorted.map((s, i) => (
            <div key={`${s.date}-${i}`} className="slot-row" data-testid="slot-row">
              <span className="slot-no">{i + 1}</span>
              <b className="slot-date">{formatDateKo(s.date)}</b>
              <input className="input" type="time" value={s.start} onChange={(e) => update(s, { start: e.target.value })} aria-label={`${i + 1}번 일정 시작 시간`} />
              <span className="muted">~</span>
              <input className="input" type="time" value={s.end} onChange={(e) => update(s, { end: e.target.value })} aria-label={`${i + 1}번 일정 종료 시간`} />
              <input className="input slot-place" value={s.place} onChange={(e) => update(s, { place: e.target.value })} placeholder="장소" aria-label={`${i + 1}번 일정 장소`} />
              <span className="row nowrap" style={{ gap: 2 }}>
                <button
                  type="button"
                  className="btn sm ghost"
                  title="같은 날 다른 시간대 추가"
                  onClick={() => add(s.date, s.start < "13:00" ? TIME_PRESETS[1] : TIME_PRESETS[0])}
                >
                  + 시간대
                </button>
                <button type="button" className="btn sm ghost" aria-label={`${i + 1}번 일정 삭제`} onClick={() => onChange(slots.filter((x) => x !== s))}>
                  ✕
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

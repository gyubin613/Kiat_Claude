"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/components/AdminShell";
import { formatSlot } from "@/lib/util";

type CalItem = { evalId: string; label: string; kind: "slot" | "final" | "deadline"; title: string };

const pad = (n: number) => String(n).padStart(2, "0");

export default function CalendarPage() {
  const { evaluations, current } = useAdmin();
  const router = useRouter();
  const today = useMemo(() => {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }, []);
  const [ym, setYm] = useState(() => {
    const first = current?.finalization?.slot.date ?? current?.slots[0]?.date ?? today;
    return first.slice(0, 7);
  });
  const [onlyCurrent, setOnlyCurrent] = useState(false);

  const items = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    const add = (date: string, it: CalItem) => map.set(date, [...(map.get(date) ?? []), it]);
    for (const e of evaluations) {
      if (onlyCurrent && e.id !== current?.id) continue;
      if (e.finalization) {
        add(e.finalization.slot.date, { evalId: e.id, kind: "final", label: `✔ ${e.finalization.slot.start} ${e.name}`, title: `[확정] ${e.name}\n${formatSlot(e.finalization.slot)}\n참석 ${e.finalization.members.length}명` });
      } else {
        e.slots.forEach((s, i) => add(s.date, { evalId: e.id, kind: "slot", label: `${s.start} ${e.name}`, title: `[후보 ${i + 1}] ${e.name}\n${formatSlot(s)}` }));
        add(e.deadline, { evalId: e.id, kind: "deadline", label: `회신기한 ${e.name}`, title: `[회신 기한] ${e.name}` });
      }
    }
    return map;
  }, [evaluations, onlyCurrent, current]);

  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const weeks = days.slice(35).every((d) => d.slice(0, 7) !== ym) ? days.slice(0, 35) : days;
  const move = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>평가 캘린더</h1>
          <p>등록된 모든 평가의 후보 일정·회신 기한·확정 일정을 월별로 확인합니다.</p>
        </div>
        <div className="row">
          <label className="row small"><input type="checkbox" checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)} /> 현재 평가만</label>
          <button className="btn" onClick={() => move(-1)} aria-label="이전 달">‹</button>
          <b style={{ minWidth: 100, textAlign: "center" }}>{y}년 {m}월</b>
          <button className="btn" onClick={() => move(1)} aria-label="다음 달">›</button>
          <button className="btn" onClick={() => setYm(today.slice(0, 7))}>오늘</button>
        </div>
      </div>
      <div className="row small">
        <span className="cal-ev">후보 일정</span>
        <span className="cal-ev final">확정 일정</span>
        <span className="cal-ev deadline">회신 기한</span>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="cal">
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <div key={d} className="cal-h" style={{ color: i === 0 ? "var(--bad)" : i === 6 ? "var(--primary)" : undefined }}>{d}</div>
          ))}
          {weeks.map((d) => (
            <div key={d} className={`cal-d ${d.slice(0, 7) !== ym ? "other" : ""} ${d === today ? "today" : ""}`}>
              <span className="cal-n">{Number(d.slice(8))}</span>
              {(items.get(d) ?? []).map((it, i) => (
                <button
                  key={i}
                  className={`cal-ev ${it.kind === "final" ? "final" : it.kind === "deadline" ? "deadline" : ""}`}
                  title={it.title}
                  style={current?.id === it.evalId ? { outline: "1.5px solid var(--primary)" } : undefined}
                  onClick={() => {
                    router.push(`/admin/${it.kind === "final" ? "finalize" : "responses"}?e=${it.evalId}`);
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

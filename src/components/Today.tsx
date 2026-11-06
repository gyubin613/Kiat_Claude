"use client";

import Link from "next/link";
import type { EvalWithCounts } from "./AdminShell";
import { followupOf } from "@/lib/types";
import { daysUntil, formatDateKo, formatSlot } from "@/lib/util";

type Todo = { tone: "bad" | "warn" | "info"; text: string; href: string; go: string };

/** 현재 평가에서 지금 처리해야 할 일만 모아 보여주는 첫 화면 */
export default function Today({ evaluation: e }: { evaluation: EvalWithCounts }) {
  const c = e.counts;
  const q = `?e=${e.id}`;
  const active = c.total - c.withdrawn;
  const confirmable = c.yes + (c.conditional - c.condPending);
  const short = Math.max(0, e.seats - confirmable);
  const f = followupOf(e);
  const dday = daysUntil(e.deadline);

  const todos: Todo[] = [];
  if (e.status !== "finalized") {
    if (!e.slots.length) todos.push({ tone: "warn", text: "후보 일정을 등록해 주세요.", href: `/admin${q}`, go: "평가 수정" });
    if (!e.rosterCount)
      todos.push({ tone: "warn", text: "이 평가의 위원 명단이 비어 있습니다. 이전 평가에서 불러오거나 엑셀로 올려 주세요.", href: `/admin/evaluators${q}`, go: "명단 만들기" });
    if (e.unread) todos.push({ tone: "bad", text: `새 위원 문의 ${e.unread}건에 답변이 필요합니다.`, href: `/admin/messages${q}`, go: "답변하기" });
    if (c.condPending) todos.push({ tone: "bad", text: `조건부 참석 문의 ${c.condPending}건에 답변하고 수락 여부를 정해 주세요.`, href: `/admin/responses${q}`, go: "답변하기" });
    if (c.notSent) todos.push({ tone: "warn", text: `초청 메일을 보내지 않은 위원이 ${c.notSent}명 있습니다.`, href: `/admin/invites${q}`, go: "메일 보내기" });
    if (active - c.no < e.seats && e.rosterCount)
      todos.push({ tone: "warn", text: `배석 ${e.seats}명 대비 초청 인원이 ${e.seats - (active - c.no)}명 부족합니다.`, href: `/admin/priority${q}`, go: "추가 섭외" });
    if (e.overdue)
      todos.push({
        tone: "info",
        text: f.enabled ? `${f.hours}시간 넘게 회신이 없는 위원 ${e.overdue}명 — 다음 순위 위원에게 자동 안내됩니다.` : `회신이 오래 없는 위원이 ${e.overdue}명 있습니다.`,
        href: `/admin/invites${q}`,
        go: "확인",
      });
    if (e.questionsWaiting) todos.push({ tone: "info", text: `확인 요청에 아직 답하지 않은 위원 ${e.questionsWaiting}명`, href: `/admin/messages${q}`, go: "보기" });
    if (short === 0 && active > 0) todos.push({ tone: "info", text: `참석 가능 위원이 배석 인원(${e.seats}명)을 채웠습니다.`, href: `/admin/finalize${q}`, go: "최종 확정" });
  }

  return (
    <div className="hero">
      <div className="card summary">
        <div className="row between">
          <h1>{e.name}</h1>
        </div>
        <dl className="kv">
          <dt>회신 기한</dt>
          <dd>
            {formatDateKo(e.deadline)}
            {e.status !== "finalized" && dday != null && (
              <b style={{ marginLeft: 6, color: dday < 0 ? "var(--bad)" : dday <= 2 ? "var(--warn)" : "var(--muted)" }}>
                {dday > 0 ? `D-${dday}` : dday === 0 ? "오늘" : `${-dday}일 지남`}
              </b>
            )}
          </dd>
          <dt>{e.status === "finalized" ? "확정 일정" : "후보 일정"}</dt>
          <dd>{e.finalization ? formatSlot(e.finalization.slot) : e.slots.length ? `${formatSlot(e.slots[0], false)}${e.slots.length > 1 ? ` 외 ${e.slots.length - 1}건` : ""}` : "미등록"}</dd>
        </dl>
        <div className="progress">
          <div className="row between small">
            <span>참석 확보 <b>{e.status === "finalized" ? e.finalization?.members.length : confirmable}</b> / {e.seats}명</span>
            <span className="muted">회신 {c.responded} / {active}명</span>
          </div>
          <div className="bar">
            <span className="yes" style={{ width: `${Math.min(100, ((e.status === "finalized" ? e.finalization?.members.length ?? 0 : confirmable) / e.seats) * 100)}%` }} />
            {e.status !== "finalized" && <span className="cond" style={{ width: `${Math.min(100, (c.condPending / e.seats) * 100)}%` }} />}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>할 일</h2><span className="small muted">{e.status === "finalized" ? "" : `${todos.length}건`}</span></div>
        <div className="todo">
          {e.status === "finalized" ? (
            <Link href={`/admin/finalize${q}`}><span className="dot" style={{ background: "var(--ok)" }} />최종 확정을 마쳤습니다.<span className="go">결과 보기</span></Link>
          ) : todos.length ? (
            todos.map((t) => (
              <Link key={t.text} href={t.href}>
                <span className={`dot ${t.tone === "info" ? "" : t.tone}`} />
                {t.text}
                <span className="go">{t.go}</span>
              </Link>
            ))
          ) : (
            <div className="done-line muted">지금 처리할 일이 없습니다. 위원 회신을 기다리는 중입니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

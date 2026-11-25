"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EvalWithCounts } from "./AdminShell";
import { nextStep, PAGE_HELP, STEPS, type StepNo } from "@/lib/guide";

const HELP_KEY = "kiat.helpHidden";

function readHidden(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(HELP_KEY) || "{}");
  } catch {
    return {};
  }
}

/**
 * 단계 화면 맨 위 안내: '지금 할 일' 한 줄 + 이 화면 사용법(접을 수 있음)
 * - 지금 할 일이 이 화면이면 '이 화면에서 할 일', 다른 화면이면 '다음 할 일'과 이동 버튼
 */
export default function StepGuide({ evaluation, step }: { evaluation: EvalWithCounts | null; step: StepNo }) {
  const help = PAGE_HELP[step];
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(!!readHidden()[step]);
  }, [step]);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(HELP_KEY, JSON.stringify({ ...readHidden(), [step]: next }));
    } catch {
      /* 저장할 수 없어도 화면에는 반영 */
    }
  };

  const n = evaluation ? nextStep(evaluation) : null;
  const here = n && n.step === step && !n.href.startsWith("/admin/messages");
  const target = n ? STEPS[n.step - 1] : null;

  return (
    <div className="guide" data-testid="step-guide">
      {n && (
        <div className={`guide-now ${n.waiting ? "waiting" : here ? "here" : "next"}`}>
          <div className="guide-text">
            <span className="guide-tag">{n.waiting ? "진행 상황" : here ? "이 화면에서 할 일" : `다음 할 일 · ${n.step}단계 ${target?.label}`}</span>
            <b>{n.title}</b>
            <span className="small">{n.detail}</span>
          </div>
          {!here && (
            <Link className="btn primary sm nowrap" href={n.href}>
              {n.cta} →
            </Link>
          )}
        </div>
      )}
      <div className="guide-help">
        <button type="button" className="guide-toggle" onClick={toggle} aria-expanded={!hidden}>
          {hidden ? "▸" : "▾"} 이 화면 사용법
        </button>
        {!hidden && (
          <ol>
            {help.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { Evaluation, Evaluator, Invite, MailResult } from "@/lib/types";
import { mailtoUrl, replyMail } from "@/lib/email";
import { formatDateTime, formatSlot } from "@/lib/util";
import { api, errMsg, useToast } from "./ui";

type Decision = "accepted" | "rejected" | null;

const DEFAULT_REPLY: Record<"accepted" | "rejected", string> = {
  accepted: "제시하신 조건을 확인하였습니다. 조건을 반영하여 참석 위원으로 모시겠습니다.",
  rejected: "제시하신 조건은 이번 평가 운영상 반영이 어렵게 되었습니다. 양해 부탁드립니다.",
};

/**
 * 조건부 참석 문의에 바로 답변하고 수락·거절까지 한 번에 처리하는 입력란.
 * 회신 현황(검토 목록)과 위원 문의 화면에서 함께 쓴다.
 */
export function ConditionAnswer({
  evaluation,
  invite,
  evaluator,
  onDone,
  compact = false,
}: {
  evaluation: Evaluation;
  invite: Invite;
  evaluator: Evaluator;
  onDone: () => void;
  compact?: boolean;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Decision | "reply" | false>(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const r = invite.response;
  if (!r || r.attendance !== "conditional") return null;
  const reviewed = invite.conditionReview;

  async function send(decision: Decision) {
    const body = text.trim() || (decision ? DEFAULT_REPLY[decision] : "");
    if (!body) return;
    setBusy(decision ?? "reply");
    setFallback(null);
    try {
      let email: MailResult | null = null;
      let link: string | null = null;
      if (decision) {
        const res = await api<{ email: MailResult | null; link: string | null }>(
          `/api/admin/evaluations/${evaluation.id}/invites/${invite.evaluatorId}`,
          { method: "POST", json: { type: "reviewCondition", decision, note: body, notify: true, reply: body } },
        );
        email = res.email;
        link = res.link;
      } else {
        const res = await api<{ email: MailResult; link: string }>(`/api/admin/evaluations/${evaluation.id}/messages/${invite.evaluatorId}`, {
          method: "POST",
          json: { body, sendEmail: true },
        });
        email = res.email;
        link = res.link;
      }
      const what = decision === "accepted" ? "수락하고 답변을 보냈습니다" : decision === "rejected" ? "거절하고 답변을 보냈습니다" : "답변을 보냈습니다";
      toast(`${evaluator.name} 위원: ${what}.`, "ok");
      if (email && email.status !== "sent" && evaluator.email && link) setFallback(mailtoUrl(evaluator.email, replyMail(evaluation, evaluator, body, link)));
      setText("");
      onDone();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  const slots = r.slotIds
    .map((id) => evaluation.slots.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => formatSlot(s!, false));

  return (
    <div className="cond-answer">
      {!compact && (
        <div className="cond-q">
          <div className="row between">
            <span className="small muted">
              {evaluator.name} 위원의 조건·문의사항 · {formatDateTime(r.updatedAt)}
            </span>
            {reviewed && (
              <span className={`badge ${reviewed.decision === "accepted" ? "ok" : "bad"}`}>{reviewed.decision === "accepted" ? "수락함" : "거절함"}</span>
            )}
          </div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{r.note}</div>
          <div className="small faint" style={{ marginTop: 4 }}>가능 일정: {slots.join(", ") || "-"}</div>
        </div>
      )}
      <textarea
        className="textarea"
        style={{ minHeight: 70 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        placeholder="위원에게 보낼 답변 (비워 두고 수락·거절을 누르면 기본 안내문을 보냅니다)"
        aria-label={`${evaluator.name} 위원 조건부 답변`}
      />
      <div className="row">
        <button className="btn sm primary" disabled={!!busy} onClick={() => send("accepted")}>
          {busy === "accepted" ? "보내는 중…" : reviewed?.decision === "accepted" ? "수락 유지하고 답변" : "수락하고 답변"}
        </button>
        <button className="btn sm danger" disabled={!!busy} onClick={() => send("rejected")}>
          {busy === "rejected" ? "보내는 중…" : reviewed?.decision === "rejected" ? "거절 유지하고 답변" : "거절하고 답변"}
        </button>
        <button className="btn sm" disabled={!!busy || !text.trim()} onClick={() => send(null)} title="수락·거절을 정하지 않고 답변만 보냅니다">
          답변만 보내기
        </button>
      </div>
      {fallback && (
        <div className="notice warn row between small">
          <span>위원 회신 화면에 게시했습니다. 메일은 자동 발송되지 않아 직접 보내 주세요.</span>
          <a className="btn sm" href={fallback}>메일 앱으로 열기</a>
        </div>
      )}
    </div>
  );
}

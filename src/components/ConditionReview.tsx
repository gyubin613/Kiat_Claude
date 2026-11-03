"use client";

import { useState } from "react";
import type { Evaluation, Evaluator, Invite, MailResult } from "@/lib/types";
import { mailtoUrl, replyMail } from "@/lib/email";
import { formatSlot } from "@/lib/util";
import { api, errMsg, Modal, useToast } from "./ui";

/** 조건부 참석 회신을 수락·거절하는 대화상자 */
export function ConditionReviewDialog({
  evaluation,
  invite,
  evaluator,
  initial,
  onClose,
  onDone,
}: {
  evaluation: Evaluation;
  invite: Invite;
  evaluator: Evaluator;
  initial: "accepted" | "rejected";
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [decision, setDecision] = useState<"accepted" | "rejected">(initial);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const r = invite.response!;

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ email: MailResult | null; link: string | null }>(
        `/api/admin/evaluations/${evaluation.id}/invites/${invite.evaluatorId}`,
        { method: "POST", json: { type: "reviewCondition", decision, note, notify } },
      );
      toast(`${evaluator.name} 위원의 조건부 참석을 ${decision === "accepted" ? "수락" : "거절"}했습니다.`, "ok");
      onDone();
      if (notify && res.email && res.email.status !== "sent" && evaluator.email && res.link) {
        const text =
          decision === "accepted"
            ? `제시하신 참석 조건을 확인하였습니다. 조건을 반영하여 참석 위원 후보로 검토하겠습니다.${note ? `\n\n${note}` : ""}`
            : `제시하신 참석 조건은 이번 평가 운영상 반영이 어렵게 되었습니다. 양해 부탁드립니다.${note ? `\n\n${note}` : ""}`;
        setFallback(mailtoUrl(evaluator.email, replyMail(evaluation, evaluator, text, res.link)));
      } else onClose();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      size="sm"
      title={`조건부 참석 검토 — ${evaluator.name}`}
      onClose={onClose}
      footer={
        fallback ? (
          <>
            <a className="btn primary" href={fallback} onClick={onClose}>메일 앱으로 안내 보내기</a>
            <button className="btn" onClick={onClose}>닫기</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>취소</button>
            <button className={`btn ${decision === "accepted" ? "primary" : "danger"}`} disabled={busy} onClick={submit}>
              {decision === "accepted" ? "수락" : "거절"}
            </button>
          </>
        )
      }
    >
      {fallback ? (
        <div className="notice warn">결과를 위원의 회신 화면에 게시했습니다. 메일은 자동으로 발송되지 않아, 업무용 메일로 직접 보내 주세요.</div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="notice">
            <div className="strong">위원이 제시한 조건</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{r.note || "(조건 미기재)"}</div>
            <div className="small muted" style={{ marginTop: 6 }}>
              가능 일정: {r.slotIds.map((id) => evaluation.slots.find((s) => s.id === id)).filter(Boolean).map((s) => formatSlot(s!, false)).join(", ")}
            </div>
          </div>
          <div className="seg" role="radiogroup" aria-label="검토 결과">
            <button className={decision === "accepted" ? "on" : ""} onClick={() => setDecision("accepted")} role="radio" aria-checked={decision === "accepted"}>
              수락 (확정 후보에 포함)
            </button>
            <button className={decision === "rejected" ? "on" : ""} onClick={() => setDecision("rejected")} role="radio" aria-checked={decision === "rejected"}>
              거절
            </button>
          </div>
          <div className="field">
            <label htmlFor="cr-note">위원에게 덧붙일 말 (선택)</label>
            <textarea id="cr-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === "accepted" ? "예) 오후 세션으로 배정하겠습니다." : "예) 이번 평가는 종일 참석이 필요합니다."} />
          </div>
          <label className="row small">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> 결과를 위원에게 안내 (회신 화면 게시 + 메일)
          </label>
          {decision === "rejected" && <p className="small muted">거절하면 불참으로 집계되며, 자동 후속 안내의 &lsquo;불참 시 즉시 안내&rsquo;가 켜져 있으면 다음 순위 위원에게 안내합니다.</p>}
        </div>
      )}
    </Modal>
  );
}

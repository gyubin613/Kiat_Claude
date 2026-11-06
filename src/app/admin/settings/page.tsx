"use client";

import { useState } from "react";
import { useAdmin } from "@/components/AdminShell";
import { api, errMsg, useToast } from "@/components/ui";

const PROVIDER_LABEL = { smtp: "메일 계정(SMTP)", resend: "Resend" } as const;

export default function SettingsPage() {
  const { meta } = useAdmin();
  const toast = useToast();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const m = meta?.email;

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      await api("/api/admin/email/test", { method: "POST", json: { to } });
      setResult({ ok: true, text: `${to} 으로 시험 메일을 보냈습니다. 받은편지함(또는 스팸함)을 확인해 주세요.` });
      toast("시험 메일을 보냈습니다.", "ok");
    } catch (e) {
      setResult({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>메일 설정</h1>
          <p>초청 메일, 문의 답변, 안내사항, 자동 후속 안내를 시스템에서 바로 보내기 위한 설정입니다.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>현재 상태</h2>
          <span className={`badge ${m?.configured ? "ok" : "warn"}`}>{m?.configured ? "발송 가능" : "설정 전 — 메일 앱으로 직접 보내는 방식"}</span>
        </div>
        <div className="card-body">
          <dl className="kv">
            <dt>발송 방식</dt>
            <dd>{m?.provider ? PROVIDER_LABEL[m.provider] : "-"}</dd>
            <dt>보내는 주소</dt>
            <dd>{m?.from ? `${m.fromName ? `${m.fromName} ` : ""}<${m.from}>` : "-"}</dd>
            <dt>답장 받을 주소</dt>
            <dd>{m?.replyTo ?? "보내는 주소와 같음"}</dd>
            <dt>위원에게 보낼 수 있는 주소</dt>
            <dd>
              {m?.allowAll ? (
                <span className="badge warn">모든 주소 허용 (*)</span>
              ) : m?.allowList.length ? (
                m.allowList.join(", ")
              ) : (
                <span style={{ color: "var(--warn)" }}>지정 안 됨 — 위원에게는 보내지 않습니다 (시험 메일만 가능)</span>
              )}
            </dd>
            <dt>문의 알림 받을 주소</dt>
            <dd>{m?.notify ?? "-"}</dd>
            <dt>자동 후속 안내 예약 실행</dt>
            <dd>{meta?.cron ? "설정됨 (CRON_SECRET)" : <span className="muted">미설정 — 관리자 화면을 열 때만 점검</span>}</dd>
          </dl>
        </div>
      </div>

      {m?.configured && (
        <div className="card">
          <div className="card-head"><h2>시험 메일 보내기</h2></div>
          <div className="card-body stack" style={{ gap: 10 }}>
            <div className="row">
              <input className="input" style={{ maxWidth: 320 }} type="email" placeholder="받을 메일 주소" value={to} onChange={(e) => setTo(e.target.value)} aria-label="시험 메일 받을 주소" />
              <button className="btn primary" disabled={busy || !to} onClick={test}>{busy ? "보내는 중…" : "시험 메일 보내기"}</button>
            </div>
            {result && <div className={`notice ${result.ok ? "ok" : "bad"}`}>{result.text}</div>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>설정 방법 (네이버 메일 예시)</h2></div>
        <div className="card-body stack" style={{ gap: 14 }}>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
            <li>네이버 메일 → 왼쪽 아래 <b>환경설정</b> → <b>POP3/IMAP 설정</b> 탭 → <b>IMAP/SMTP 사용함</b>으로 바꾸고 저장합니다.</li>
            <li>네이버 <b>내정보 → 보안설정</b>에서 <b>2단계 인증</b>을 켜고, <b>애플리케이션 비밀번호</b>를 하나 만듭니다. 화면을 닫으면 다시 볼 수 없으니 바로 복사해 두세요.</li>
            <li>Vercel 프로젝트 → <b>Settings → Environment Variables</b>에 아래 값을 넣습니다.</li>
            <li>Vercel <b>Deployments</b>에서 맨 위 배포의 <b>⋯ → Redeploy</b>를 누른 뒤, 이 화면에서 시험 메일을 보내 봅니다.</li>
          </ol>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>이름</th><th>값</th><th>설명</th></tr></thead>
              <tbody>
                <tr><td className="mono">SMTP_HOST</td><td className="mono">smtp.naver.com</td><td className="small">Gmail은 smtp.gmail.com, 기관 메일은 전산 담당에 문의</td></tr>
                <tr><td className="mono">SMTP_PORT</td><td className="mono">465</td><td className="small">SSL 연결</td></tr>
                <tr><td className="mono">SMTP_USER</td><td className="mono">아이디@naver.com</td><td className="small">전체 메일 주소</td></tr>
                <tr><td className="mono">SMTP_PASS</td><td className="mono">(애플리케이션 비밀번호)</td><td className="small">로그인 비밀번호가 아닌 앱 비밀번호</td></tr>
                <tr><td className="mono">EMAIL_FROM_NAME</td><td className="mono">기술평가팀</td><td className="small">받는 사람에게 보이는 이름 (선택)</td></tr>
                <tr><td className="mono">EMAIL_ALLOWED_RECIPIENTS</td><td className="mono">me@naver.com,@example.org</td><td className="small">위원에게 보낼 수 있는 주소·도메인. 쉼표로 구분. <b>*</b>는 모든 주소</td></tr>
                <tr><td className="mono">ADMIN_NOTIFY_EMAIL</td><td className="mono">담당자@기관.kr</td><td className="small">위원 문의 알림·답장 받을 주소 (선택)</td></tr>
              </tbody>
            </table>
          </div>
          <div className="notice warn small">
            시제품 단계에서는 <b>EMAIL_ALLOWED_RECIPIENTS</b>에 본인·동료의 시험용 주소만 넣어 확인하세요. 실제 평가위원에게 보내려면(<b>*</b> 사용) 개인 메일 계정 사용 가능 여부, 발신 주소, 개인정보 처리 등 기관 보안 검토를 먼저 거쳐야 합니다.
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

export default function LoginForm({ next }: { next: string }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
        if (res.ok) window.location.href = next;
        else {
          const d = await res.json().catch(() => ({}));
          setErr(d.error || "로그인에 실패했습니다.");
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="pw">비밀번호</label>
        <input id="pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <span className="err">{err}</span>}
      </div>
      <button className="btn primary lg" disabled={busy || !pw}>
        {busy ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Evaluation } from "@/lib/types";
import { api, ConfirmProvider, ToastProvider } from "./ui";
import { daysUntil, formatDateKo } from "@/lib/util";

export type Counts = { total: number; notSent: number; waiting: number; yes: number; conditional: number; condPending: number; no: number; withdrawn: number; responded: number };
export type EvalWithCounts = Evaluation & { counts: Counts; unread: number; questionsWaiting: number; overdue: number; rosterCount: number };
export type Meta = {
  storage: "redis" | "memory";
  devPassword: boolean;
  email: {
    configured: boolean;
    provider: "smtp" | "resend" | null;
    from: string | null;
    fromName: string | null;
    replyTo: string | null;
    allowList: string[];
    allowAll: boolean;
    notify: string | null;
  };
  cron: boolean;
};

type Ctx = {
  evaluations: EvalWithCounts[];
  current: EvalWithCounts | null;
  setCurrentId: (id: string | null) => void;
  reload: () => Promise<void>;
  checkFollowups: (force?: boolean) => void;
  meta: Meta | null;
  loading: boolean;
};

const AdminCtx = createContext<Ctx | null>(null);
export function useAdmin() {
  const c = useContext(AdminCtx);
  if (!c) throw new Error("AdminShell 밖에서 사용할 수 없습니다.");
  return c;
}

const LS_KEY = "kiat.currentEvaluation";

const STEPS = [
  { href: "/admin", label: "평가 등록", step: 1 },
  { href: "/admin/evaluators", label: "평가위원 명단", step: 2 },
  { href: "/admin/priority", label: "우선순위·섭외", step: 3 },
  { href: "/admin/invites", label: "초청 메일", step: 4 },
  { href: "/admin/responses", label: "회신 현황", step: 5 },
  { href: "/admin/finalize", label: "최종 확정", step: 6 },
];

export const STATUS_BADGE: Record<Evaluation["status"], { label: string; cls: string }> = {
  draft: { label: "준비 중", cls: "" },
  inviting: { label: "섭외 진행", cls: "info" },
  finalized: { label: "확정 완료", cls: "ok" },
};

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const [evaluations, setEvaluations] = useState<EvalWithCounts[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [storedId, setStoredId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const [list, m] = await Promise.all([
      api<{ evaluations: EvalWithCounts[] }>("/api/admin/evaluations"),
      api<Meta>("/api/admin/meta"),
    ]);
    setEvaluations(list.evaluations);
    setMeta(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload().catch(() => setLoading(false));
  }, [reload]);

  // 무응답 자동 후속 안내 점검: 스케줄러 외에 관리자 화면을 열 때도 실행 (10분에 한 번)
  const checkFollowups = useCallback((force = false) => {
    const KEY = "kiat.followupCheckedAt";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (!force && Date.now() - last < 10 * 60 * 1000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
    api<{ results: { name: string; invited: { name: string; sent: boolean }[] }[] }>("/api/admin/followup", { method: "POST", json: {} })
      .then((r) => {
        const n = r.results.reduce((s, x) => s + x.invited.length, 0);
        if (n) {
          setNotice(`무응답 자동 후속 안내: ${r.results.map((x) => `${x.name} — ${x.invited.map((i) => `${i.name}${i.sent ? "(메일 발송)" : "(발송 필요)"}`).join(", ")}`).join(" / ")}`);
          reload();
        }
      })
      .catch(() => {});
  }, [reload]);
  useEffect(() => {
    checkFollowups();
  }, [checkFollowups]);

  // 현재 평가 결정: 사용자가 고른 평가(selectedId) → 없으면 가장 최근 등록 평가
  // selectedId 는 URL(?e=)이 바뀌면 따라가고, 최초 진입 시 URL이 없으면 최근 선택(localStorage)을 사용
  const urlId = search.get("e");
  useEffect(() => {
    if (urlId) setStoredId(urlId);
  }, [urlId]);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    // 하이드레이션 시점에 useSearchParams 값이 늦게 반영될 수 있어 주소창을 직접 읽는다
    setStoredId(new URLSearchParams(window.location.search).get("e") || localStorage.getItem(LS_KEY));
    setInitialized(true);
  }, []);
  const currentId = useMemo(() => {
    if (loading || !initialized) return null;
    const valid = (id: string | null) => (id && evaluations.some((e) => e.id === id) ? id : null);
    return valid(storedId) ?? evaluations[0]?.id ?? null;
  }, [loading, initialized, evaluations, storedId]);

  // URL에 현재 평가를 반영해 새로고침·메뉴 이동·링크 공유 시에도 유지
  useEffect(() => {
    if (!currentId) return;
    localStorage.setItem(LS_KEY, currentId);
    // 주소에 유효한 평가가 있으면 그 평가로 이동하는 중이므로 덮어쓰지 않는다 (위 효과에서 선택이 따라감)
    const urlValid = !!urlId && evaluations.some((e) => e.id === urlId);
    if (!urlValid && urlId !== currentId) {
      const p = new URLSearchParams(search.toString());
      p.set("e", currentId);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }
  }, [currentId, urlId, pathname, router, search, evaluations]);

  const setCurrentId = useCallback(
    (id: string | null) => {
      setStoredId(id);
      if (id) localStorage.setItem(LS_KEY, id);
      else localStorage.removeItem(LS_KEY);
      const p = new URLSearchParams(search.toString());
      if (id) p.set("e", id);
      else p.delete("e");
      router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
    },
    [pathname, router, search],
  );

  const current = useMemo(() => evaluations.find((e) => e.id === currentId) ?? null, [evaluations, currentId]);
  const q = current ? `?e=${current.id}` : "";

  const done = (step: number) => {
    if (!current) return false;
    const c = current.counts;
    switch (step) {
      case 1: return current.slots.length > 0;
      case 2: return current.rosterCount > 0;
      case 3: return c.total - c.withdrawn >= current.seats;
      case 4: return c.total > 0 && c.notSent === 0;
      case 5: return c.total > 0 && c.waiting === 0 && c.notSent === 0;
      case 6: return current.status === "finalized";
    }
    return false;
  };
  // 사이드바에는 '처리할 일'이 있을 때만 숫자를 표시
  const badge = (step: number): { n: number; cls: string } | null => {
    if (!current || current.status === "finalized") return null;
    const c = current.counts;
    if (step === 4 && c.notSent) return { n: c.notSent, cls: "warn" };
    if (step === 5 && c.condPending) return { n: c.condPending, cls: "warn" };
    return null;
  };

  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  const commit = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
  const feedbackUrl = repo
    ? `https://github.com/${repo}/issues/new?template=feedback.yml&page=${encodeURIComponent(pathname)}&build=${commit || "local"}`
    : null;

  const dday = current ? daysUntil(current.deadline) : null;

  return (
    <AdminCtx.Provider value={{ evaluations, current, setCurrentId, reload, checkFollowups, meta, loading }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <strong>평가위원 섭외·일정조율</strong>
            <span>통합관리 시스템 (시제품)</span>
          </div>
          <nav className="rail" aria-label="업무 순서">
            {STEPS.map((s) => {
              const active = s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href);
              const b = badge(s.step);
              return (
                <Link key={s.href} href={s.href + q} className={`nav-item ${active ? "active" : ""} ${done(s.step) ? "done" : ""}`}>
                  <span className="nav-step">{done(s.step) && !active ? "✓" : s.step}</span>
                  {s.label}
                  {b && <span className={`nav-count ${b.cls}`}>{b.n}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="nav-label">소통·조회</div>
          <Link href={"/admin/messages" + q} className={`nav-item ${pathname.startsWith("/admin/messages") ? "active" : ""}`}>
            위원 문의·안내
            {current?.unread ? <span className="nav-count">{current.unread}</span> : null}
          </Link>
          <Link href={"/admin/calendar" + q} className={`nav-item ${pathname.startsWith("/admin/calendar") ? "active" : ""}`}>
            평가 캘린더
          </Link>
          <Link href={"/admin/settings" + q} className={`nav-item ${pathname.startsWith("/admin/settings") ? "active" : ""}`}>
            메일 설정
            {meta && !meta.email.configured && <span className="nav-count warn" title="메일 발송 설정 전">!</span>}
          </Link>
          <div className="sidebar-foot">
            {meta && (
              <span>
                저장소: {meta.storage === "redis" ? "Redis(중앙)" : "메모리(시연용)"}
              </span>
            )}
            {feedbackUrl && (
              <a href={feedbackUrl} target="_blank" rel="noreferrer">
                피드백·버그 신고
              </a>
            )}
            {commit && <span className="mono">build {commit}</span>}
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
            >
              로그아웃
            </button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="current">
              {evaluations.length ? (
                <select
                  className="select"
                  aria-label="현재 작업 중인 평가"
                  value={current?.id ?? ""}
                  onChange={(e) => setCurrentId(e.target.value)}
                >
                  {evaluations.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.status === "finalized" ? " (확정)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="muted">{loading ? "불러오는 중…" : "등록된 평가가 없습니다"}</span>
              )}
              {current && (
                <>
                  <span className={`badge ${STATUS_BADGE[current.status].cls}`}>{STATUS_BADGE[current.status].label}</span>
                  <span className="small muted nowrap">
                    회신기한 {formatDateKo(current.deadline)}
                    {dday != null && current.status !== "finalized" && (
                      <b style={{ color: dday < 0 ? "var(--bad)" : dday <= 2 ? "var(--warn)" : undefined }}>
                        {" "}
                        {dday > 0 ? `D-${dday}` : dday === 0 ? "D-day" : `기한 경과 ${-dday}일`}
                      </b>
                    )}
                  </span>
                  <span className="small muted nowrap">배석 {current.seats}명</span>
                  <Link href={`/admin?e=${current.id}`} className="small" style={{ marginLeft: "auto" }}>할 일 보기</Link>
                </>
              )}
            </div>
          </header>
          {meta?.storage === "memory" && (
            <div className="notice warn" style={{ borderRadius: 0 }}>
              시연 모드입니다. 데이터가 서버 메모리에만 있어 재배포하면 지워집니다. Vercel에서 Upstash Redis를 연결해 주세요.
            </div>
          )}
          {notice && (
            <div className="notice ok row between" style={{ borderRadius: 0 }}>
              <span>{notice}</span>
              <button className="btn sm ghost" onClick={() => setNotice("")}>닫기</button>
            </div>
          )}
          {(() => {
            const others = evaluations.filter((e) => e.id !== current?.id && e.unread > 0);
            return others.length ? (
              <div className="notice" style={{ borderRadius: 0 }}>
                다른 평가에 확인하지 않은 위원 문의가 있습니다: {others.map((e) => (
                  <Link key={e.id} href={`/admin/messages?e=${e.id}`} style={{ marginRight: 10 }}>{e.name} ({e.unread})</Link>
                ))}
              </div>
            ) : null;
          })()}
          <main className="content">{children}</main>
        </div>
      </div>
    </AdminCtx.Provider>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Suspense fallback={<div className="content">불러오는 중…</div>}>
          <Shell>{children}</Shell>
        </Suspense>
      </ConfirmProvider>
    </ToastProvider>
  );
}

/** 현재 평가가 필요한 화면에서 사용 */
export function NeedEvaluation({ children }: { children: (e: EvalWithCounts) => ReactNode }) {
  const { current, loading } = useAdmin();
  if (loading) return <div className="muted">불러오는 중…</div>;
  if (!current)
    return (
      <div className="card">
        <div className="empty">
          <div className="strong">먼저 평가를 등록하거나 선택해 주세요.</div>
          <Link className="btn primary" href="/admin">
            평가 일정 등록으로 이동
          </Link>
        </div>
      </div>
    );
  return <>{children(current)}</>;
}

"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Evaluation } from "@/lib/types";
import { api, ConfirmProvider, ToastProvider } from "./ui";
import { daysUntil, formatDateKo } from "@/lib/util";

export type Counts = { total: number; notSent: number; waiting: number; yes: number; conditional: number; no: number; withdrawn: number; responded: number };
export type EvalWithCounts = Evaluation & { counts: Counts };
export type Meta = {
  storage: "redis" | "memory";
  devPassword: boolean;
  evaluatorCount: number;
  email: { configured: boolean; from: string | null; allowList: string[] };
};

type Ctx = {
  evaluations: EvalWithCounts[];
  current: EvalWithCounts | null;
  setCurrentId: (id: string | null) => void;
  reload: () => Promise<void>;
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
  { href: "/admin", label: "평가 일정 등록", step: 1 },
  { href: "/admin/evaluators", label: "평가위원 명단", step: 2 },
  { href: "/admin/priority", label: "섭외 우선순위", step: 3 },
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
    if (urlId !== currentId) {
      const p = new URLSearchParams(search.toString());
      p.set("e", currentId);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }
  }, [currentId, urlId, pathname, router, search]);

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
      case 2: return (meta?.evaluatorCount ?? 0) > 0;
      case 3: return c.total - c.withdrawn >= current.seats;
      case 4: return c.total > 0 && c.notSent === 0;
      case 5: return c.total > 0 && c.waiting === 0 && c.notSent === 0;
      case 6: return current.status === "finalized";
    }
    return false;
  };
  const hint = (step: number) => {
    if (!current) return null;
    const c = current.counts;
    if (step === 2) return meta ? `${meta.evaluatorCount}명` : null;
    if (step === 3) return `${c.total - c.withdrawn}/${current.seats}`;
    if (step === 4 && c.notSent) return `미발송 ${c.notSent}`;
    if (step === 5 && c.total) return `${c.responded}/${c.total - c.withdrawn}`;
    return null;
  };

  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  const commit = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
  const feedbackUrl = repo
    ? `https://github.com/${repo}/issues/new?template=feedback.yml&page=${encodeURIComponent(pathname)}&build=${commit || "local"}`
    : null;

  const dday = current ? daysUntil(current.deadline) : null;

  return (
    <AdminCtx.Provider value={{ evaluations, current, setCurrentId, reload, meta, loading }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <strong>평가위원 섭외·일정조율</strong>
            <span>통합관리 시스템 (시제품)</span>
          </div>
          <div className="nav-label">업무 순서</div>
          {STEPS.map((s) => {
            const active = s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href);
            return (
              <Link key={s.href} href={s.href + q} className={`nav-item ${active ? "active" : ""} ${done(s.step) ? "done" : ""}`}>
                <span className="nav-step">{done(s.step) && !active ? "✓" : s.step}</span>
                {s.label}
                {hint(s.step) && <span className="nav-hint">{hint(s.step)}</span>}
              </Link>
            );
          })}
          <div className="nav-label">조회</div>
          <Link href={"/admin/calendar" + q} className={`nav-item ${pathname.startsWith("/admin/calendar") ? "active" : ""}`}>
            <span className="nav-step">▦</span>평가 캘린더
          </Link>
          <div className="sidebar-foot">
            {meta && (
              <span>
                저장소: {meta.storage === "redis" ? "Redis(중앙)" : "메모리(시연용)"}
              </span>
            )}
            {feedbackUrl && (
              <a href={feedbackUrl} target="_blank" rel="noreferrer">
                💬 피드백·버그 신고 (GitHub)
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
              <span className="current-label">현재 작업 중인 평가</span>
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
                </>
              )}
            </div>
          </header>
          {meta?.storage === "memory" && (
            <div className="notice warn" style={{ borderRadius: 0 }}>
              시연 모드: 데이터가 서버 메모리에만 저장되어 재배포·재시작 시 초기화됩니다. 여러 사용자가 함께 쓰려면 Upstash Redis를 연결하세요.
            </div>
          )}
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

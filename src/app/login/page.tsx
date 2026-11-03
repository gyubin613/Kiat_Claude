import { adminPassword, usingDevPassword } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  return (
    <div className="public" style={{ display: "grid", placeItems: "center" }}>
      <div className="card" style={{ width: "min(400px, 100%)" }}>
        <div className="card-body stack">
          <div>
            <h1>관리자 로그인</h1>
            <p className="muted" style={{ marginTop: 6 }}>평가위원 섭외 및 일정조율 통합관리 시스템 (시제품)</p>
          </div>
          {!adminPassword() && (
            <div className="notice bad">
              서버에 관리자 비밀번호가 설정되지 않았습니다. Vercel 프로젝트 설정 → Environment Variables에 <b>ADMIN_PASSWORD</b>를 추가한 뒤 다시 배포해 주세요.
            </div>
          )}
          {usingDevPassword() && (
            <div className="notice warn">
              개발 모드 기본 비밀번호: <b className="mono">demo1234</b> (ADMIN_PASSWORD 설정 시 변경됨)
            </div>
          )}
          <LoginForm next={safeNext} />
          <p className="small faint">※ 본 시스템은 가상 데이터를 활용한 시연용 시제품입니다. 실제 개인정보를 입력하지 마십시오.</p>
        </div>
      </div>
    </div>
  );
}

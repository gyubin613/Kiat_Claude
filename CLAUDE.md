# 작업 지침 (AI·개발자 공통)

평가위원 섭외 및 일정조율 통합관리 웹시스템 시제품. Next.js 15 App Router + TypeScript + Upstash Redis, Vercel 배포.

## 명령어
- `npm run dev` / `npm run typecheck` / `npm run lint` / `npm test` / `npm run build`
- PR 전 typecheck·lint·test·build 모두 통과해야 함

## 이슈 처리 방식
1. 이슈의 화면 경로·재현 순서로 문제를 먼저 재현한다 (가상 데이터: ① 화면 [가상 데이터 불러오기])
2. 원인을 고치고, 업무 규칙이 바뀌면 `tests/`에 테스트를 추가한다
3. 브랜치 `fix/이슈번호-요약` 또는 `feat/이슈번호-요약`, PR 본문에 `Fixes #번호`
4. 범위를 넘는 요청(실제 개인정보 사용, 외부 서비스 실발송 등)은 구현하지 말고 이슈에 검토 필요사항으로 답한다

## 지켜야 할 원칙
- 화면 문구는 한국어, 공문서체에 가까운 정중한 표현
- 평가위원 기본정보(`Evaluator`)와 평가별 운영정보(`Invite`, `Finalization`)는 분리 유지
- 확정(`status: "finalized"`) 이후 평가·초청·회신 변경은 서버에서 423으로 차단 — UI만 막지 말 것
- 문서 갱신은 `repo.ts`의 `updateWithVersion`(클라이언트 버전 기준) / `updateWithRetry`(서버 내부)를 통해서만
- 부분 수정 스키마(`*Patch`)에는 `.default()`를 쓰지 않는다 (zod v4는 partial 안에서도 기본값을 채워 기존 값을 덮어씀)
- `useEffect`는 항상 블록 본문 `useEffect(() => { ... })`으로 작성 (최신 Chrome의 `scrollIntoView` 등은 Promise를 반환해 React 정리 함수 오류 발생)
- 조건부 참석은 관리자가 '수락'한 경우에만 확정 후보 — 집계·확정·후속 안내 모두 `summary.ts`의 `isConfirmable`/`isConditionPending`/`isDeclined`를 사용
- 학력은 이해관계 확인용 표시이며 가중치에는 해외 대학 여부만 반영
- 우선순위 점수는 "참고자료" — 예측·보증 표현 금지
- 비밀값은 환경변수로만. 실제 개인정보·내부자료를 테스트 데이터나 이슈에 넣지 않는다

// 업무 시나리오 E2E (계획서 8장 기능 검증). 사용: BASE_URL=http://localhost:3000 ADMIN_PASSWORD=... node e2e/scenario.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const PW = process.env.ADMIN_PASSWORD || "demo1234";
const OUT = path.join(__dirname, "artifacts");
fs.mkdirSync(OUT, { recursive: true });

async function makeFixture() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("명단");
  ws.addRow(["이름", "소속", "이메일", "전화번호", "전문분야", "초청횟수", "참여횟수", "선호도", "비고", "기타열"]);
  ws.addRow(["테스트위원A", "가상연구소", "newA@example.com", "010-1111-2222", "AI", 2, 1, 4, "", "x"]);
  ws.addRow(["중복위원", "가상", "evaluator01@example.com", "010-9999-9999", "", "", "", "", "기존 이메일과 중복", ""]);
  ws.addRow(["", "이름없음", "", "", "", "", "", "", "", ""]);
  ws.addRow(["오류위원", "가상", "bad-email", "", "", 1, 5, 9, "", ""]);
  ws.addRow(["테스트위원B", "", "", "", "로봇", "", "", "", "소속·이메일 누락", ""]);
  const file = path.join(OUT, "import.xlsx");
  await wb.xlsx.writeFile(file);
  return file;
}
const errors = [];
(async () => {
  const fixture = await makeFixture();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true });
  const step = (s) => console.log("✔", s);

  await page.goto(BASE + "/admin");
  await page.fill("#pw", "wrong"); await page.click("button:has-text('로그인')");
  await page.waitForSelector("text=비밀번호가 올바르지 않습니다"); step("잘못된 비밀번호 거부");
  await page.fill("#pw", PW); await page.click("button:has-text('로그인')");
  await page.waitForURL(/\/admin/); step("로그인");

  await page.click("button:has-text('가상 데이터 불러오기') >> nth=0");
  await page.click(".modal button:has-text('불러오기')");
  await page.waitForSelector("text=가상 데이터를 불러왔습니다");
  await page.waitForSelector("td:has-text('지역혁신 클러스터 연차평가')");
  await page.waitForTimeout(500);
  await shot("01-evaluations"); step("가상 데이터 불러오기");
  await page.waitForSelector("text=무응답 자동 후속 안내:");
  step("48시간 무응답 위원 → 다음 순위 자동 초청 (가상 데이터 불러온 직후 점검)");

  // 현재 평가 전환 후 새로고침해도 유지
  const sel = page.locator("select[aria-label='현재 작업 중인 평가']");
  const opts = await sel.locator("option").allTextContents();
  const target = opts.find((o) => o.includes("신규과제"));
  await sel.selectOption({ label: target });
  await page.waitForTimeout(50);
  await page.click("a.nav-item:has-text('회신 현황')");
  await page.waitForSelector("text=후보 일정별 참석 가능 인원");
  await page.waitForSelector("text=후보 일정별 참석 가능 인원");
  await page.reload();
  await page.waitForSelector("text=후보 일정별 참석 가능 인원");
  const after = await sel.evaluate((s) => s.options[s.selectedIndex].text);
  if (!after.includes("신규과제")) throw new Error("평가 선택이 새로고침 후 유지되지 않음: " + after);
  if (!page.url().includes("/admin/responses")) throw new Error("메뉴가 유지되지 않음");
  step("새로고침 후 평가·메뉴 유지");
  await page.waitForTimeout(400);
  await shot("05-responses");

  // 평가별 자동 후속 안내 기간 설정
  await page.click("a.nav-item:has-text('평가 등록')");
  await page.waitForSelector("text=할 일");
  await shot("00-home-today");
  const row = page.locator("tr:has-text('소재부품')");
  await row.locator("summary[aria-label='더보기']").click();
  await row.locator(".menu-pop button:has-text('수정')").click();
  await page.click(".modal button:has-text('3일(72시간)')");
  await page.click(".modal button:has-text('저장')");
  await page.waitForSelector("tr:has-text('소재부품') >> text=72시간");
  step("평가별 자동 후속 안내 기간 설정 (72시간)");

  // 평가위원 개별 수정 (변경 항목만)
  await page.click("a.nav-item:has-text('평가위원 명단')");
  await page.waitForSelector("table.table tbody tr");
  await page.waitForSelector("th:has-text('최종학력')");
  await page.locator("table.table tbody tr").first().locator("button:has-text('수정')").click();
  await page.waitForSelector(".modal >> text=학력 (이해관계 확인용)");
  await page.fill("#f-phone", "010-7777-7777");
  await page.waitForSelector("text=변경된 항목 1개만 저장됩니다.");
  await shot("02-evaluator-edit");
  await page.click(".modal button:has-text('저장')");
  await page.waitForSelector("text=1개 항목을 저장했습니다");
  step("개별 정보 수정(변경 항목만 저장)");

  // 엑셀 일괄 등록
  await page.click("button:has-text('엑셀 일괄 등록')");
  await page.setInputFiles("input[type=file]", fixture);
  await page.click(".modal button:has-text('내용 확인')");
  await page.waitForSelector(".modal >> text=이메일 중복");
  await shot("03-import-preview");
  const txt = await page.locator(".modal").innerText();
  for (const s of ["인식하지 못한 열", "기타열", "이메일 형식", "선호도는 1~5", "성명을 입력"]) if (!txt.includes(s)) throw new Error("미리보기 누락: " + s);
  await page.click(".modal button:has-text('등록하기')");
  await page.waitForSelector(".modal >> text=신규 등록");
  const res = await page.locator(".modal").innerText();
  if (!res.includes("정보 보완") && !res.includes("건너뜀")) throw new Error("중복 처리 결과 없음");
  await shot("03b-import-result");
  await page.click(".modal button:has-text('닫기')");
  step("엑셀 일괄 등록(미리보기·중복·오류 처리)");

  // 우선순위
  await page.click("a.nav-item:has-text('우선순위·섭외')");
  await page.waitForSelector("text=참고 점수");
  await page.waitForSelector("table.table tbody tr");
  await page.waitForSelector("text=해외경험");
  await page.waitForSelector("text=/이해관계 확인 필요/");
  await page.waitForTimeout(300);
  await shot("04-priority");
  const top0 = await page.locator("tbody tr").first().innerText();
  await page.locator("input[aria-label='해외경험 가중치']").fill("100");
  await page.locator("input[aria-label='과거 이력 가중치']").fill("0");
  await page.locator("input[aria-label='관리자 선호도 가중치']").fill("0");
  await page.waitForTimeout(200);
  const top1 = await page.locator("tbody tr").first().innerText();
  if (!/해외/.test(top1)) throw new Error("해외경험 가중치 100%인데 1순위가 해외경험 없음: " + top1.slice(0, 80));
  if (top0 === top1) console.log("  (가중치 변경 전후 1순위 동일)");
  step("가중치에 해외경험 반영 · 학력 표시 · 이해관계 표시");
  await page.locator("tbody tr input[type=checkbox]:not([disabled])").first().check();
  await page.click("button:has-text('초청 대상에 추가')");
  await page.waitForSelector("text=초청 대상에 추가했습니다");
  step("후순위 후보 추가 섭외");

  // 초청 메일
  await page.click("a.nav-item:has-text('초청 메일')");
  await page.waitForSelector("text=자동 후속 안내 사용 중");
  await page.waitForSelector("td .badge.dark:has-text('자동')");
  await page.waitForSelector("text=무응답 → 다음 순위 안내됨");
  await page.waitForSelector("text=/자동 후속까지 \\d+시간/");
  await shot("06a-invites-followup");
  step("초청 메일 화면: 자동 후속 상태·남은 시간 표시");
  await page.locator("tbody tr:last-child button:has-text('메일')").click();
  await page.waitForSelector(".preview-mail");
  const evName = (await page.locator(".modal-head h2").innerText()).replace("초청 메일 — ", "").split(" (")[0];
  await shot("06-invite-mail");
  const body = await page.locator(".modal .preview-mail").innerText();
  const link = body.match(/https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/)[0];
  if (/\{\{/.test(body)) throw new Error("치환되지 않은 자리표시자");
  await page.click(".modal button:has-text('발송 완료 표시')");
  await page.waitForSelector("text=발송 완료로 표시했습니다");
  await page.click(".modal button:has-text('닫기')");
  await page.click("button:has-text('메일 양식 편집')");
  await page.waitForSelector("text=자동 입력 항목");
  await shot("06b-template");
  step("초청 메일 미리보기·발송 표시");

  // 평가위원 회신 (모바일)
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on("pageerror", (e) => errors.push(`[mobile pageerror] ${e.message}`));
  await mp.goto(link);
  await mp.waitForSelector("text=참석 여부를 선택해 주세요");
  await mp.screenshot({ path: path.join(OUT, "07-respond-start.png"), fullPage: true });
  await mp.click("button:has-text('문의하기')");
  await mp.fill("textarea[aria-label='문의 내용']", "평가 당일 주차가 가능한지 문의드립니다.");
  await mp.click("button:has-text('문의 보내기')");
  await mp.waitForSelector("text=문의가 담당자에게 전달되었습니다");
  step("평가위원: 회신 전 문의 남기기");
  await mp.click("button[role=radio]:has-text('참석 불가')");
  if (await mp.locator("text=참석 가능한 일정을 모두 선택").count()) throw new Error("불참인데 일정 선택이 표시됨");
  await mp.click("button[role=radio]:has-text('조건부 참석 가능')");
  await mp.click("button:has-text('회신 제출')");
  await mp.waitForSelector("text=참석 가능한 일정을 1개 이상");
  await mp.locator("button[role=checkbox]").nth(0).click();
  await mp.locator("button[role=checkbox]").nth(1).click();
  await mp.click("button:has-text('회신 제출')");
  await mp.waitForSelector("text=조건부 참석의 조건");
  await mp.fill("textarea[aria-label='참고사항']", "오후 1시 이후 가능합니다.");
  await mp.screenshot({ path: path.join(OUT, "07b-respond-filled.png"), fullPage: true });
  await mp.click("button:has-text('회신 제출')");
  await mp.waitForSelector("text=회신이 정상적으로 저장되었습니다");
  await mp.screenshot({ path: path.join(OUT, "08-respond-done.png"), fullPage: true });
  await mp.click("button:has-text('응답 수정')");
  await mp.click("button[role=radio]:has-text('참석 가능') >> nth=0");
  await mp.click("button:has-text('수정한 내용 제출')");
  await mp.waitForSelector("text=회신이 정상적으로 저장되었습니다");
  step("평가위원 모바일 회신·수정");

  // 관리자 화면 반영
  await page.click("a.nav-item:has-text('회신 현황')");
  await page.waitForSelector("text=후보 일정별 참석 가능 인원");
  await page.waitForSelector("text=(수정 1회)");
  step("관리자 화면 회신 반영");

  // 조건부 참석 검토 (가상 데이터의 검토 전 조건부 회신)
  await page.waitForSelector("text=조건부 참석 검토");
  await page.locator(".card:has(h2:has-text('조건부 참석 검토')) button:has-text('수락')").first().click();
  await page.fill("#cr-note", "오후 세션으로 배정하겠습니다.");
  await page.click(".modal-foot button:has-text('수락')");
  await page.waitForSelector("text=/조건부 참석을 수락했습니다/");
  await page.waitForSelector(".modal >> text=메일 앱으로 안내 보내기");
  await page.click(".modal-foot button:has-text('닫기')");
  await page.waitForSelector("td .badge:has-text('조건부 · 수락')");
  await shot("05b-condition-review");
  step("조건부 참석 검토 → 수락 (확정 후보 반영)");

  // 위원 문의 답변 (메일 서비스 미설정 → 회신 화면 게시 + 메일 앱 열기 제공)
  await page.click("a.nav-item:has-text('위원 문의·안내')");
  await page.locator(`button.msg-item:has-text('${evName}')`).click();
  await page.waitForSelector("text=평가 당일 주차가 가능한지");
  await page.fill("textarea[aria-label='답변 내용']", "본관 지하주차장을 이용하실 수 있습니다.");
  await page.click("button:has-text('답변 보내기')");
  await page.waitForSelector("text=메일이 자동 발송되지 않았습니다");
  if (!(await page.locator("a[href^='mailto:']:has-text('메일 앱으로 열기')").count())) throw new Error("메일 앱 열기 대체 수단 없음");
  await shot("08a-admin-reply");
  step("관리자: 문의 답변 게시 (메일 미설정 시 메일 앱 열기 제공)");

  // 관리자 확인 요청 → 위원 답변 → 관리자 확인
  await page.click("button[role=radio]:has-text('확인 요청')");
  await page.fill("textarea[aria-label='답변 내용']", "평가 당일 차량 번호를 알려 주실 수 있을까요?");
  await page.click("button:has-text('확인 요청 보내기')");
  await page.waitForSelector(".bubble .badge:has-text('답변 대기')");
  await mp.reload();
  await mp.waitForSelector("text=담당자 확인 요청");
  await mp.fill("textarea[aria-label='확인 요청 답변']", "12가 3456입니다.");
  await mp.click(".card:has-text('담당자 확인 요청') button:has-text('답변 보내기')");
  await mp.waitForSelector(".bubble:has-text('12가 3456입니다.')");
  await page.reload();
  await page.locator(`button.msg-item:has-text('${evName}')`).click();
  await page.waitForSelector(".bubble:has-text('12가 3456입니다.')");
  await page.waitForSelector(".bubble .badge:has-text('답변 받음')");
  step("관리자 확인 요청 → 위원 답변 → 관리자 화면에서 확인");

  // 전체 안내
  await page.click("button.tab:has-text('전체·대상별 안내')");
  await page.fill("input[placeholder*='사전 검토자료']", "사전 검토자료 송부 안내");
  await page.fill(".card:has-text('새 안내사항') textarea", "평가 3일 전까지 메일로 송부드리겠습니다.");
  await page.click("button:has-text('명에게 보내기')");
  await page.click(".modal button:has-text('보내기')");
  await page.waitForSelector("text=명에게 게시했습니다");
  await shot("08b-announcement");
  step("관리자: 초청 위원 전체에 안내사항 게시");

  await mp.reload();
  await mp.waitForSelector("text=사전 검토자료 송부 안내");
  await mp.waitForSelector("text=본관 지하주차장을 이용하실 수 있습니다.");
  await mp.screenshot({ path: path.join(OUT, "08c-respond-messages.png"), fullPage: true });
  step("평가위원 화면: 답변·안내사항 확인");

  // 엑셀 다운로드
  await page.click("a.nav-item:has-text('회신 현황')");
  await page.waitForSelector("text=후보 일정별 참석 가능 인원");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('엑셀 다운로드')")]);
  await dl.saveAs(path.join(OUT, "responses.xlsx"));
  step("회신 결과 엑셀 다운로드: " + dl.suggestedFilename());

  // 최종 확정
  await page.click("a.nav-item:has-text('최종 확정')");
  await page.waitForSelector("text=최종 평가 일시 선택");
  await page.locator(".choice").nth(1).click();
  await page.waitForSelector("text=참석 위원 선정");
  await shot("09-finalize");
  await page.click("button.lg:has-text('최종 확정')");
  await page.click(".modal button:has-text('확정')");
  await page.waitForSelector("text=최종 확정 완료");
  await shot("10-finalized");
  step("최종 확정");

  // 확정 후 변경 제한 (회신 링크)
  await mp.reload();
  await mp.waitForSelector("text=평가 일정이 확정되었습니다");
  if (await mp.locator("button:has-text('응답 수정')").count()) throw new Error("확정 후에도 응답 수정 버튼이 노출됨");
  await mp.screenshot({ path: path.join(OUT, "11-respond-finalized.png"), fullPage: true });
  const r = await mp.request.post(link.replace("/r/", "/api/respond/"), { data: { attendance: "no" } });
  if (r.status() !== 423) throw new Error("확정 후 API 수정이 차단되지 않음: " + r.status());
  step("확정 이후 회신 변경 차단(423)");

  // 관리자 API 무단 접근 차단
  const anon = await browser.newContext();
  const ar = await anon.request.get(BASE + "/api/admin/evaluators");
  if (ar.status() !== 401) throw new Error("비로그인 API 접근이 차단되지 않음");
  step("비로그인 관리자 API 차단(401)");

  await page.click("a.nav-item:has-text('평가 캘린더')");
  await page.waitForSelector(".cal");
  await page.waitForTimeout(300);
  await shot("12-calendar");
  step("캘린더");

  await browser.close();
  // 의도된 로그인 실패(401)와 외부 웹폰트 네트워크 차단(샌드박스 환경)은 제외
  const real = errors.filter((e) => !e.includes("status of 401") && !/net::ERR_/.test(e));
  console.log(real.length ? "\n오류:\n" + real.join("\n") : "\n콘솔 오류 없음 (의도된 로그인 실패 401 제외)");
  if (real.length) process.exit(1);
})().catch(async (e) => { console.error("FAIL:", e.message); console.log(errors.join("\n")); process.exit(1); });

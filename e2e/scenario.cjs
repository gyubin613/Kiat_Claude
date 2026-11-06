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
  await page.click("button:has-text('엑셀로 추가·업데이트')");
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

  // 조건부 참석 문의 → 회신 현황에서 바로 답변하며 수락 (가상 데이터의 조건부 회신)
  const condCard = page.locator(".card:has(h2:has-text('조건부 참석 문의'))");
  await condCard.waitFor();
  await condCard.locator("textarea").first().fill("오후 세션으로 모시겠습니다. 13시까지 와 주시면 됩니다.");
  await shot("05b-condition-answer");
  await condCard.locator("button:has-text('수락하고 답변')").first().click();
  await page.waitForSelector("text=/수락하고 답변을 보냈습니다/");
  await page.waitForSelector("td .badge:has-text('조건부 · 수락')");
  step("조건부 참석 문의에 바로 답변하며 수락 (확정 후보 반영)");

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

  // 평가별 위원 명단: 새 평가 등록 시 '이전 평가에서 불러오기 → 선택'
  await page.click("a.nav-item:has-text('평가 등록')");
  await page.click("button:has-text('새 평가 등록')");
  await page.fill(".modal input[placeholder^='예) 2026년']", "E2E 명단 불러오기 평가");
  await page.locator(".modal input[type=date]").first().fill("2030-01-01");
  await page.fill(".modal input[aria-label='1번 일정 날짜']", "2030-01-10");
  await page.click(".modal button[role=radio]:has-text('이전 평가에서 불러오기')");
  const srcSel = page.locator(".modal select[aria-label='불러올 평가']");
  const srcOpts = await srcSel.locator("option").evaluateAll((os) => os.map((o) => [o.value, o.text]));
  await srcSel.selectOption(srcOpts.find((o) => o[1].includes("신규과제"))[0]);
  await page.click(".modal button[role=radio]:has-text('선택')");
  await page.click(".modal-foot button:has-text('저장')");
  await page.waitForURL(/\/admin\/evaluators\?e=.*load=.*mode=pick/);
  await page.waitForSelector(".modal >> text=이전 평가에서 위원 불러오기");
  await page.waitForSelector(".modal select#copy-from option:has-text('신규과제')", { state: "attached" });
  await page.waitForSelector(".modal tbody input[type=checkbox]");
  const curName = await page.locator("select[aria-label='현재 작업 중인 평가']").evaluate((s) => s.options[s.selectedIndex].text);
  if (!curName.includes("E2E 명단 불러오기 평가")) throw new Error("새로 등록한 평가로 전환되지 않음: " + curName);
  if (!(await page.locator(".modal select#copy-from").evaluate((s) => s.options[s.selectedIndex].text)).includes("신규과제"))
    throw new Error("양식에서 고른 원본 평가가 선택되지 않음");
  await page.locator(".modal tbody input[type=checkbox]").nth(0).check();
  await page.locator(".modal tbody input[type=checkbox]").nth(1).check();
  await shot("13-roster-pick");
  await page.click(".modal-foot button:has-text('선택한 2명 불러오기')");
  await page.waitForSelector(".modal td .badge:has-text('불러옴')");
  await page.click(".modal-foot button:has-text('닫기')");
  if ((await page.locator("table.table tbody tr").count()) !== 2) throw new Error("선택한 2명만 명단에 있어야 함");
  step("새 평가 등록 → 이전 평가에서 선택 불러오기 (2명)");

  await page.click("button:has-text('이전 평가에서 불러오기')");
  const srcSel2 = page.locator(".modal select#copy-from");
  await page.waitForSelector(".modal select#copy-from option:has-text('지역혁신')", { state: "attached" });
  const opts2 = await srcSel2.locator("option").evaluateAll((os) => os.map((o) => [o.value, o.text]));
  await srcSel2.selectOption(opts2.find((o) => o[1].includes("지역혁신"))[0]);
  await page.waitForSelector(".modal tbody tr");
  await page.click(".modal-foot button:has-text('명 모두 불러오기')");
  await page.waitForSelector(".modal td .badge:has-text('불러옴')");
  await page.click(".modal-foot button:has-text('닫기')");
  const n = await page.locator("table.table tbody tr").count();
  if (n <= 2) throw new Error("일괄 불러오기 후 명단이 늘어나야 함");
  const [rdl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('엑셀 다운로드')")]);
  await rdl.saveAs(path.join(OUT, "roster.xlsx"));
  await shot("14-roster");
  step(`이전 평가에서 일괄 불러오기 (명단 ${n}명) · 명단 엑셀 다운로드`);

  // 자동 섭외: 등록 시 선택 → 끌어서 순서 조정 → 시작 → 불참 시 바로 다음 순서
  await page.click("a.nav-item:has-text('평가 등록')");
  await page.click("button:has-text('새 평가 등록')");
  await page.fill(".modal input[placeholder^='예) 2026년']", "E2E 자동 섭외 평가");
  await page.locator(".modal input[type=date]").first().fill("2030-01-01");
  await page.fill(".modal input[aria-label='1번 일정 날짜']", "2030-01-10");
  await page.fill(".modal input[min='1'][max='50']", "2");
  await page.click(".modal button[role=radio]:has-text('이전 평가에서 불러오기')");
  const s3 = page.locator(".modal select[aria-label='불러올 평가']");
  const o3 = await s3.locator("option").evaluateAll((os) => os.map((o) => [o.value, o.text]));
  await s3.selectOption(o3.find((o) => o[1].includes("지역혁신"))[0]);
  await page.click(".modal button[role=radio]:has-text('자동 섭외')");
  await page.waitForSelector(".modal >> text=회신이 없을 때 다음 순서로 넘어가는 시간");
  await page.click(".modal-foot button:has-text('저장')");
  await page.waitForURL(/\/admin\/evaluators\?e=/);
  await page.waitForSelector("table.table tbody tr");
  await page.click("a.nav-item:has-text('우선순위·섭외')");
  await page.waitForSelector("text=자동 섭외 순서");
  const names = async () => page.locator(".q-row .who b").allInnerTexts();
  const before = await names();
  await page.dragAndDrop(`[data-testid='queue-${before[2]}']`, `[data-testid='queue-${before[0]}']`);
  const afterDrag = await names();
  if (afterDrag[0] !== before[2]) throw new Error(`끌어서 순서 변경 실패: ${afterDrag.slice(0, 3)}`);
  await page.click(`button[aria-label='${afterDrag[1]} 아래로']`);
  const order = await names();
  if (order[2] !== afterDrag[1]) throw new Error("↓ 버튼 순서 변경 실패");
  await page.waitForSelector("text=/여기까지 시작하자마자 메일 발송/");
  await shot("15-auto-queue");
  step(`자동 섭외 순서 조정 (끌어서 놓기·↓): ${order.slice(0, 3).join(" → ")}`);

  await page.click("button:has-text('자동 섭외 시작')");
  await page.click(".modal-foot button:has-text('시작')");
  await page.waitForSelector("text=/자동 섭외를 시작했습니다/");
  await page.waitForSelector(".auto-status .badge:has-text('진행 중')");
  await page.click("a.nav-item:has-text('초청 메일')");
  await page.waitForSelector("text=자동 섭외 진행 중");
  const invited = await page.locator("tbody tr .who b").allInnerTexts();
  const clean = (t) => t.replace(/\s*\d+차$/, "").trim();
  if (invited.length !== 2 || clean(invited[0]) !== order[0] || clean(invited[1]) !== order[1])
    throw new Error(`시작 시 앞 순서 2명이 초청돼야 함: ${invited}`);
  step("자동 섭외 시작 → 앞 순서 2명 즉시 초청");

  // 1순위 위원이 불참 → 즉시 3순위 위원 초청
  await page.locator(`tbody tr:has-text('${order[0]}') button:has-text('메일')`).click();
  const body2 = await page.locator(".modal .preview-mail").innerText();
  const link2 = body2.match(/https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/)[0];
  await page.click(".modal-foot button:has-text('닫기')");
  const ev = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ep = await ev.newPage();
  await ep.goto(link2);
  await ep.click("button[role=radio]:has-text('참석 불가')");
  await ep.click("button:has-text('회신 제출')");
  await ep.waitForSelector("text=회신이 정상적으로 저장되었습니다");
  await page.reload();
  await page.waitForSelector(`tbody tr:has-text('${order[2]}')`);
  const after3 = (await page.locator("tbody tr .who b").allInnerTexts()).map(clean);
  if (!after3.includes(order[2])) throw new Error("불참 후 다음 순서 위원이 초청되지 않음");
  await shot("16-auto-next");
  step(`불참 회신 즉시 다음 순서(${order[2]}) 자동 초청`);

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

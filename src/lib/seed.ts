// 시연용 가상 데이터. 실존 인물·기관 정보가 아니며 이메일은 예약 도메인(example.com)을 사용한다.
import {
  K,
  updateWithRetry,
  applyInviteAction,
  createEvaluation,
  createEvaluator,
  copyEvaluators,
  listEvaluators,
  createInvites,
  finalizeEvaluation,
  getEvaluation,
  listInvites,
  resetAll,
  submitResponse,
} from "./repo";
import { DEFAULT_TEMPLATE } from "./email";
import type { Attendance, Evaluator, Invite } from "./types";
import { createAnnouncement, postAdminMessage, postConditionMessage, postEvaluatorMessage } from "./comm";

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"];
const GIVEN = ["민준", "서연", "도윤", "지우", "하준", "서윤", "은우", "지민", "시우", "수아", "현우", "예린", "준서", "다은", "건우", "채원", "우진", "소율", "선호", "나연", "태윤", "가은", "재원", "하린", "승민", "유진", "동현", "수빈", "정훈", "아름"];
const ORGS = ["한결대학교", "누리공과대학교", "온새미로대학교", "미래소재연구원", "한울에너지연구소", "다온테크(주)", "새솔정밀(주)", "가람바이오(주)", "빛누리전자(주)", "푸른산업기술연구원"];
const KR_UNIV = ["한결대학교", "누리공과대학교", "온새미로대학교", "가온대학교", "다솜과학기술원"];
const FOREIGN_UNIV = ["Example State University", "Sample Institute of Technology", "Demo University of Tokyo", "Fictional TU Munich"];
const MAJORS = ["기계공학", "전자공학", "화학공학", "신소재공학", "컴퓨터공학", "산업공학", "생명공학"];
const FIELDS = ["기계설계", "반도체 공정", "이차전지", "바이오소재", "인공지능", "디스플레이", "수소에너지", "정밀가공", "로봇제어", "기술사업화", "산업디자인", "환경공학"];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function kstDate(offsetDays: number) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000);
  // 주말이면 다음 월요일로
  const wd = d.getUTCDay();
  if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const rankDemo = <T extends Evaluator>(list: T[]) =>
  [...list].sort((a, b) => (b.preference ?? 3) + (b.pastAttended ?? 0) * 0.3 - ((a.preference ?? 3) + (a.pastAttended ?? 0) * 0.3) || a.name.localeCompare(b.name, "ko"));

export async function seedDemoData(baseUrl = "http://localhost:3000") {
  await resetAll();
  const rand = rng(20261103);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  // 가상 위원 30명의 입력값 (엑셀 업로드에 해당)
  const inputs: Parameters<typeof createEvaluator>[1][] = [];
  for (let i = 0; i < 30; i++) {
    const noHistory = i % 7 === 3;
    const invited = noHistory ? null : Math.floor(rand() * 9);
    const attended = invited == null ? null : Math.floor(rand() * (invited + 1));
    inputs.push(
      {
        name: SURNAMES[i % SURNAMES.length] + GIVEN[i],
        org: pick(ORGS),
        email: i === 13 ? "" : `evaluator${String(i + 1).padStart(2, "0")}@example.com`,
        phone: `010-0000-${String(1000 + i * 37).slice(-4)}`,
        expertise: (() => {
          const a = pick(FIELDS);
          let b = pick(FIELDS);
          while (b === a) b = pick(FIELDS);
          return `${a}, ${b}`;
        })(),
        pastInvited: invited,
        pastAttended: attended,
        preference: i % 5 === 4 ? null : 1 + Math.floor(rand() * 5),
        note: i === 13 ? "이메일 확인 필요" : i % 9 === 0 ? "오전 일정 선호" : "",
        ...(() => {
          if (i % 11 === 6) return {}; // 학력 미입력 위원
          const major = pick(MAJORS);
          const bAbroad = i % 13 === 2;
          const bachelorSchool = bAbroad ? pick(FOREIGN_UNIV) : pick(KR_UNIV);
          const deg = (["박사", "박사", "석사", "학사"] as const)[i % 4];
          const fAbroad = deg !== "학사" && (bAbroad || i % 3 === 0);
          const finalSchool = deg === "학사" ? bachelorSchool : fAbroad ? pick(FOREIGN_UNIV) : pick(KR_UNIV);
          const years = i % 5 === 1 ? 1 + (i % 4) : i % 7 === 0 ? null : 0;
          return {
            bachelorSchool,
            bachelorMajor: major,
            bachelorAbroad: bAbroad,
            finalDegree: deg,
            finalSchool,
            finalMajor: major,
            finalAbroad: deg === "학사" ? bAbroad : fAbroad,
            overseasWorkYears: years,
            overseasWorkDetail: years ? pick(["미국 연구소 박사후연구원", "독일 기업 연구원", "일본 대학 객원연구원"]) : "",
          };
        })(),
      },
    );
  }

  // ③ 확정 완료된 평가
  const e3 = await createEvaluation({
    name: "지역혁신 클러스터 연차평가",
    department: "지역산업팀",
    contactName: "이운영 선임",
    deadline: kstDate(-3),
    seats: 3,
    requirements: "",
    slots: [
      { date: kstDate(7), start: "10:00", end: "16:00", place: "지역센터 회의실" },
      { date: kstDate(8), start: "10:00", end: "16:00", place: "지역센터 회의실" },
    ],
    historyWeight: 40,
    emailTemplate: DEFAULT_TEMPLATE,
  });
  // 지난 평가 명단: 엑셀로 20명 업로드
  for (const inp of inputs.slice(0, 20)) await createEvaluator(e3.id, inp, { allowDuplicate: true });
  const roster3 = rankDemo(await listEvaluators(e3.id));
  const third = roster3.slice(2, 7);
  await createInvites(e3.id, third.map((v) => v.id));
  const ev3 = await getEvaluation(e3.id);
  const inv3 = await listInvites(e3.id);
  const plan3: Attendance[] = ["yes", "yes", "no", "yes", "conditional"];
  for (let i = 0; i < third.length; i++) {
    const inv = inv3.find((x) => x.evaluatorId === third[i].id)!;
    await applyInviteAction(e3.id, inv.evaluatorId, { type: "markSent", via: "manual" });
    await submitResponse(inv.token, {
      attendance: plan3[i],
      slotIds: plan3[i] === "no" ? [] : [ev3.slots[0].id, ...(i % 2 ? [ev3.slots[1].id] : [])],
      note: plan3[i] === "conditional" ? "오전만 가능" : "",
    });
  }
  const latest3 = await getEvaluation(e3.id);
  await finalizeEvaluation(e3.id, {
    slotId: ev3.slots[0].id,
    evaluatorIds: [third[0].id, third[1].id, third[3].id],
    memo: "시연용 확정 데이터",
    version: latest3.version,
  });


  // ① 회신 진행 중인 평가
  const e1 = await createEvaluation({
    name: "2026년 산업기술 R&D 신규과제 선정평가 (1차)",
    department: "기술평가팀",
    contactName: "홍길동 선임",
    deadline: kstDate(5),
    seats: 5,
    requirements: "- 평가 1시간 전 도착\n- 사전 검토자료는 회신 후 별도 송부\n- 신분증 지참",
    slots: [
      { date: kstDate(14), start: "10:00", end: "17:00", place: "본관 3층 대회의실" },
      { date: kstDate(15), start: "10:00", end: "17:00", place: "본관 3층 대회의실" },
      { date: kstDate(16), start: "13:00", end: "18:00", place: "별관 2층 세미나실" },
    ],
    historyWeight: 50,
    weights: { history: 50, preference: 30, overseas: 20 },
    conflictKeywords: ["다온테크", "가온대학교"],
    emailTemplate: DEFAULT_TEMPLATE,
    followup: { enabled: true, hours: 48, onDecline: false, autoSend: true },
  });
  // 이번 평가 명단: 지난 평가 명단을 일괄로 불러오고(참여 결과를 과거 이력에 반영) + 새 위원 10명 엑셀 업로드
  await copyEvaluators(e1.id, e3.id, null, { applyHistory: true });
  for (const inp of inputs.slice(20)) await createEvaluator(e1.id, inp, { allowDuplicate: true });
  const ranked = rankDemo(await listEvaluators(e1.id));
  const first = ranked.slice(0, 8);
  await createInvites(e1.id, first.map((v) => v.id));
  const plan: (null | { a: Attendance; s: number[]; n?: string })[] = [
    { a: "yes", s: [0, 1] },
    { a: "yes", s: [1] },
    { a: "conditional", s: [0, 2], n: "오후 2시 이후에만 참석 가능한데, 오후 세션만 참여해도 괜찮을까요?" },
    { a: "no", s: [], n: "해외 출장 일정과 겹칩니다." },
    { a: "no", s: [], n: "같은 주에 다른 평가 일정이 있습니다." },
    null, // 회신 대기 (48시간 경과 → 자동 후속 안내 대상)
    { a: "no", s: [], n: "학회 일정으로 참석이 어렵습니다." },
    null, // 회신 대기 (20시간 경과)
  ];
  const ev1 = await getEvaluation(e1.id);
  const inv1 = await listInvites(e1.id);
  for (let i = 0; i < first.length; i++) {
    const inv = inv1.find((x) => x.evaluatorId === first[i].id)!;
    await applyInviteAction(e1.id, inv.evaluatorId, { type: "markSent", via: "manual" });
    const p = plan[i];
    if (p) await submitResponse(inv.token, { attendance: p.a, slotIds: p.s.map((k) => ev1.slots[k].id), note: p.n ?? "" });
    if (p?.a === "conditional") await postConditionMessage(e1.id, inv.evaluatorId, p.n ?? "", baseUrl, { notify: false });
  }

  // 회신 대기 2명: 1명은 48시간 경과(자동 후속 대상), 1명은 20시간 경과
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const waiting = [first[5], first[7]];
  await updateWithRetry<Invite>(K.invite(e1.id, waiting[0].id), (c) => ({ ...c, sentAt: hoursAgo(50) }), "초청");
  await updateWithRetry<Invite>(K.invite(e1.id, waiting[1].id), (c) => ({ ...c, sentAt: hoursAgo(20) }), "초청");

  // 위원 문의·답변·안내 예시
  const tokenOf = (id: string) => inv1.find((x) => x.evaluatorId === id)!.token;
  await postEvaluatorMessage(tokenOf(first[1].id), "주차 지원이 가능한지 궁금합니다.", baseUrl, { notify: false });
  await postAdminMessage(e1.id, first[1].id, "본관 지하주차장 이용이 가능하며, 평가 당일 주차권을 드립니다.", false, baseUrl);
  await postEvaluatorMessage(tokenOf(waiting[1].id), "사전 검토자료는 언제쯤 받을 수 있을까요? 확인 후 일정 회신드리겠습니다.", baseUrl, { notify: false });
  await postAdminMessage(e1.id, first[0].id, "평가 당일 오후 세션 좌장을 맡아 주실 수 있으신지 확인 부탁드립니다.", false, baseUrl, { kind: "question" });
  await createAnnouncement(
    e1.id,
    { title: "평가 장소 안내", body: "본관 3층 대회의실은 엘리베이터 하차 후 오른쪽입니다.", audience: "all", sendEmail: false },
    baseUrl,
  );

  // ② 준비 중인 평가 (초청 전)
  await createEvaluation({
    name: "소재부품 기술개발사업 중간평가",
    department: "사업관리팀",
    contactName: "김담당 책임",
    deadline: kstDate(12),
    seats: 4,
    requirements: "- 온라인 평가 병행 가능",
    slots: [
      { date: kstDate(24), start: "09:30", end: "12:30", place: "온라인(화상)" },
      { date: kstDate(25), start: "14:00", end: "17:00", place: "본관 5층 중회의실" },
    ],
    historyWeight: 50,
    emailTemplate: DEFAULT_TEMPLATE,
    followup: { enabled: true, hours: 24, onDecline: true, autoSend: true },
  });

  // ② 소재부품 중간평가는 명단을 비워 두어 '이전 평가에서 불러오기'를 바로 시험할 수 있게 한다
  return { evaluators: inputs.length, evaluations: 3 };
}

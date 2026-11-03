// 시연용 가상 데이터. 실존 인물·기관 정보가 아니며 이메일은 예약 도메인(example.com)을 사용한다.
import {
  applyInviteAction,
  createEvaluation,
  createEvaluator,
  createInvites,
  finalizeEvaluation,
  getEvaluation,
  listInvites,
  resetAll,
  submitResponse,
} from "./repo";
import { DEFAULT_TEMPLATE } from "./email";
import type { Attendance, Evaluator } from "./types";

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"];
const GIVEN = ["민준", "서연", "도윤", "지우", "하준", "서윤", "은우", "지민", "시우", "수아", "현우", "예린", "준서", "다은", "건우", "채원", "우진", "소율", "선호", "나연", "태윤", "가은", "재원", "하린", "승민", "유진", "동현", "수빈", "정훈", "아름"];
const ORGS = ["한결대학교", "누리공과대학교", "온새미로대학교", "미래소재연구원", "한울에너지연구소", "다온테크(주)", "새솔정밀(주)", "가람바이오(주)", "빛누리전자(주)", "푸른산업기술연구원"];
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

export async function seedDemoData() {
  await resetAll();
  const rand = rng(20261103);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  const evaluators: Evaluator[] = [];
  for (let i = 0; i < 30; i++) {
    const noHistory = i % 7 === 3;
    const invited = noHistory ? null : Math.floor(rand() * 9);
    const attended = invited == null ? null : Math.floor(rand() * (invited + 1));
    const ev = await createEvaluator(
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
      },
      { allowDuplicate: true },
    );
    evaluators.push(ev);
  }

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
    historyWeight: 60,
    emailTemplate: DEFAULT_TEMPLATE,
  });
  const ranked = [...evaluators].sort(
    (a, b) => (b.preference ?? 3) + (b.pastAttended ?? 0) * 0.3 - ((a.preference ?? 3) + (a.pastAttended ?? 0) * 0.3),
  );
  const first = ranked.slice(0, 8);
  await createInvites(e1.id, first.map((v) => v.id));
  const plan: (null | { a: Attendance; s: number[]; n?: string })[] = [
    { a: "yes", s: [0, 1] },
    { a: "yes", s: [1] },
    { a: "conditional", s: [0, 2], n: "오후 2시 이후 참석 가능합니다." },
    { a: "no", s: [], n: "해외 출장 일정과 겹칩니다." },
    { a: "yes", s: [0, 1, 2] },
    null, // 회신 대기
    { a: "yes", s: [1, 2] },
    null,
  ];
  const ev1 = await getEvaluation(e1.id);
  const inv1 = await listInvites(e1.id);
  for (let i = 0; i < first.length; i++) {
    const inv = inv1.find((x) => x.evaluatorId === first[i].id)!;
    await applyInviteAction(e1.id, inv.evaluatorId, { type: "markSent", via: "manual" });
    const p = plan[i];
    if (p) await submitResponse(inv.token, { attendance: p.a, slotIds: p.s.map((k) => ev1.slots[k].id), note: p.n ?? "" });
  }

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
  });

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
  const third = ranked.slice(10, 15);
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

  return { evaluators: evaluators.length, evaluations: 3 };
}

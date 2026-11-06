// 가상 과제 목록(xlsx)과 가상 메일(.eml, zip 묶음)을 만든다.
// 실제 기관·과제와 무관한 시연용 데이터이며, 도메인은 모두 .example 형식이다.
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "samples");
mkdirSync(OUT, { recursive: true });

// ---------- 가상 과제 30개 ----------
const LEADS = [
  ["(주)한빛로보틱스", "hanbitrobotics.example.kr", "박서준"],
  ["(주)세움바이오", "seumbio.example.kr", "이하은"],
  ["(주)온누리모빌리티", "onnurimobility.example.kr", "최도윤"],
  ["(주)다온에너지", "daonenergy.example.kr", "정민서"],
  ["(주)누리소재", "nurimaterials.example.kr", "강지호"],
  ["(주)가람반도체", "garamsemi.example.kr", "윤서연"],
  ["(주)하늘드론", "haneuldrone.example.kr", "임준우"],
  ["(주)미르헬스케어", "mirhealth.example.kr", "한유진"],
  ["(주)새봄스마트팜", "saebomfarm.example.kr", "오시우"],
  ["(주)바른수소", "bareunh2.example.kr", "서지안"],
];
const PARTNERS = [
  ["Nordlicht Institute of Technology", "nordlicht.example.de", "Germany", "Anna Weber"],
  ["Alpenrot Research Center", "alpenrot.example.ch", "Switzerland", "Lukas Meier"],
  ["Helsinki Northern Labs", "hnlabs.example.fi", "Finland", "Mikko Virtanen"],
  ["Rijnland University of Applied Sciences", "rijnland.example.nl", "Netherlands", "Sanne de Vries"],
  ["Loire Valley Engineering School", "loire-eng.example.fr", "France", "Camille Martin"],
  ["Cascadia Advanced Materials Inc.", "cascadia-am.example.com", "USA", "Emily Johnson"],
  ["Ontario Clean Energy Institute", "ocei.example.ca", "Canada", "Liam Tremblay"],
  ["Vistula Polytechnic", "vistula.example.pl", "Poland", "Piotr Kowalski"],
  ["Danube Mobility Lab GmbH", "danubelab.example.at", "Austria", "Julia Gruber"],
  ["Aegean Marine Research", "aegean-mr.example.gr", "Greece", "Nikos Papadopoulos"],
  ["Iberia Smart Grid Foundation", "isgf.example.es", "Spain", "Lucia Garcia"],
  ["Baltic Photonics Institute", "balticphotonics.example.lt", "Lithuania", "Tomas Kazlauskas"],
  ["Kyushu Applied Robotics Lab", "kyushu-arl.example.jp", "Japan", "Haruto Sato"],
  ["Melbourne BioProcess Centre", "mbpc.example.au", "Australia", "Olivia Brown"],
  ["Tuscany Precision Engineering", "tuscany-pe.example.it", "Italy", "Marco Rossi"],
  ["Nordic Hydrogen Alliance", "nordich2.example.se", "Sweden", "Erik Lindqvist"],
  ["Bavaria Sensor Systems GmbH", "bavariasensor.example.de", "Germany", "Felix Bauer"],
  ["Prague Institute of Energy", "pie.example.cz", "Czech Republic", "Jana Novakova"],
  ["Lisbon Ocean Tech", "lisbonocean.example.pt", "Portugal", "Joao Silva"],
  ["Copenhagen Health Data Lab", "chdl.example.dk", "Denmark", "Sofie Nielsen"],
];
const TOPICS = [
  "협동로봇 기반 정밀 조립 자동화 기술",
  "바이오 의약품 연속 생산 공정 기술",
  "자율주행 소형 물류 모빌리티 플랫폼",
  "차세대 고체전해질 배터리 소재",
  "초경량 탄소복합소재 성형 기술",
  "전력반도체 패키징 방열 기술",
  "산업용 드론 실시간 점검 시스템",
  "웨어러블 생체신호 모니터링 기술",
  "수직형 스마트팜 환경제어 기술",
  "그린수소 수전해 스택 내구성 향상",
];
const MANAGERS = ["김OO", "이OO", "박OO"];

const projects = [];
for (let i = 0; i < 30; i++) {
  const lead = LEADS[i % 10];
  // 26, 27번 과제는 같은 해외기관(Nordlicht)과 함께 → 모호한 경우 시연
  // 0~19번은 서로 다른 해외기관, 20번 이후는 앞 과제와 같은 해외기관(현실처럼 일부 중복)
  const partner = i === 26 || i === 27 ? PARTNERS[0] : PARTNERS[i < 20 ? i : i - 20];
  const topic = TOPICS[(i + Math.floor(i / 10)) % 10];
  const variant = ["", " 고도화", " 실증"][Math.floor(i / 10)];
  const id = `P00${31001 + i}`;
  const partnerFirst = partner[3].split(" ")[0].toLowerCase();
  const leadPerson = ["sjpark", "hlee", "dychoi", "msjung", "jhkang", "syyoon", "jwlim", "yjhan", "swoh", "jaseo"][i % 10];
  projects.push({
    id,
    name: `${topic}${variant}`,
    leadOrg: lead[0],
    leadEmail: `${leadPerson}${Math.floor(i / 10) || ""}@${lead[1]}`,
    leadName: lead[2],
    partnerOrg: partner[0],
    partnerEmail: `${partnerFirst}.${i}@${partner[1]}`,
    partnerName: partner[3],
    partnerDomain: partner[1],
    country: partner[2],
    manager: MANAGERS[i % 3],
    year: "2026",
  });
}

async function writeProjectList() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("과제목록");
  ws.columns = [
    { header: "No", key: "no", width: 5 },
    { header: "과제번호", key: "id", width: 12 },
    { header: "과제명", key: "name", width: 40 },
    { header: "주관기관", key: "leadOrg", width: 20 },
    { header: "주관기관 이메일", key: "leadEmail", width: 32 },
    { header: "해외기관", key: "partnerOrg", width: 36 },
    { header: "국가", key: "country", width: 12 },
    { header: "해외기관 이메일", key: "partnerEmail", width: 34 },
    { header: "담당자", key: "manager", width: 8 },
    { header: "연도", key: "year", width: 8 },
  ];
  projects.forEach((p, i) => ws.addRow({ no: i + 1, ...p }));
  ws.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(join(OUT, "과제목록_가상.xlsx"));
}

// ---------- 가상 PDF ----------
function fakePdf(title, lines) {
  // 영문만 넣는 최소 PDF (시연용)
  const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?");
  const text = [title, ...lines]
    .map((l, i) => `BT /F1 ${i === 0 ? 18 : 11} Tf 60 ${760 - i * 24} Td (${esc(l)}) Tj ET`)
    .join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ---------- .eml 만들기 ----------
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, "$&\r\n");

let seq = 0;
function eml({ fromName, from, subject, body, date, attachments = [] }) {
  seq += 1;
  const boundary = `----=_Part_${seq}_${Date.now()}`;
  const d = new Date(date);
  const headers = [
    `From: ${encWord(fromName)} <${from}>`,
    `To: =?UTF-8?B?${b64("국제협력전략실")}?= <intl-docs@kiat-demo.example.kr>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${d.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <demo-${seq}@mail.example>`,
    "MIME-Version: 1.0",
  ];
  if (!attachments.length) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(b64(body)),
    ].join("\r\n");
  }
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(body)),
  ];
  for (const a of attachments) {
    const fn = encodeURIComponent(a.name);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.type || "application/pdf"}; name="${encWord(a.name)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename*=UTF-8''${fn}`,
      "",
      wrap76(a.data.toString("base64")),
    );
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

const day = (dd, hh = 10, mm = 0) => `2026-${dd <= 30 ? "11" : "12"}-${String(dd <= 30 ? dd : dd - 30).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+09:00`;

const mails = [];
const add = (name, m) => mails.push({ name, content: eml(m) });

const loc = (p) => ({ name: `Letter_of_Commitment_${p.partnerOrg.split(" ")[0]}_signed.pdf`, data: fakePdf("Letter of Commitment", [p.partnerOrg, `Project: ${p.id}`, "Signed by authorized representative", "Date: 2026-12-01"]) });
const agr = (p, n = "Consortium_Agreement") => ({ name: `${n}_${p.id}.pdf`, data: fakePdf("Consortium Agreement", [p.leadOrg.replace(/[^\x20-\x7e]/g, "") || "Lead", p.partnerOrg, "Signed copy"]) });
const fin = (p) => [
  { name: `2026_재무제표_${p.leadOrg.replace(/[()주]/g, "")}.pdf`, data: fakePdf("Financial Statement 2026", ["Balance sheet (demo)"]) },
  { name: "감사보고서.pdf", data: fakePdf("Audit Report", ["Independent auditor (demo)"]) },
];

// 0~7: 세 가지 서류를 모두 제출 (완료)
for (let i = 0; i < 8; i++) {
  const p = projects[i];
  add(`${p.id}_loc.eml`, {
    fromName: p.partnerName, from: p.partnerEmail,
    subject: `[${p.id}] Signed Letter of Commitment`,
    body: `Dear KIAT team,\n\nPlease find attached our signed Letter of Commitment for the joint project ${p.id}.\n\nBest regards,\n${p.partnerName}\n${p.partnerOrg}`,
    date: day(30 + (i % 5), 17, 10 + i), attachments: [loc(p)],
  });
  add(`${p.id}_agreement.eml`, {
    fromName: p.partnerName, from: p.partnerEmail,
    subject: "Consortium agreement - signed copy",
    body: `Hello,\n\nAttached is the signed consortium agreement between ${p.leadOrg.replace(/[()주]/g, "")} and ${p.partnerOrg}.\n\nKind regards,\n${p.partnerName}`,
    date: day(33 + (i % 6), 16, 5 + i), attachments: [agr(p)],
  });
  add(`${p.id}_finance.eml`, {
    fromName: p.leadName, from: p.leadEmail,
    subject: `${p.name} 재무증빙 서류 제출`,
    body: `안녕하세요, ${p.leadOrg} ${p.leadName}입니다.\n\n${p.name} 과제 관련 재무증빙 서류(재무제표, 감사보고서)를 송부드립니다.\nK-PASS 마감으로 메일로 제출합니다.\n\n감사합니다.`,
    date: day(31 + (i % 7), 9, 30 + i), attachments: fin(p),
  });
}

// 8~13: 확약서 + 협약서를 한 메일에 (재무증빙 미제출 → 일부 제출)
for (let i = 8; i < 14; i++) {
  const p = projects[i];
  add(`${p.id}_bundle.eml`, {
    fromName: p.partnerName, from: p.partnerEmail,
    subject: `Documents for KIAT joint project (${p.id})`,
    body: `Dear Sir or Madam,\n\nPlease find attached the Letter of Commitment and the signed Agreement.\n\nBest,\n${p.partnerName}`,
    date: day(32 + (i % 6), 18, i), attachments: [loc(p), agr(p, "Research_Agreement")],
  });
}

// 14~17: 해외기관의 다른 직원(연락처 미등록, 같은 도메인)이 확약서만 보냄
for (let i = 14; i < 18; i++) {
  const p = projects[i];
  add(`${p.id}_colleague.eml`, {
    fromName: "Research Office", from: `research.office@${p.partnerDomain}`,
    subject: "Letter of Commitment",
    body: `Dear colleagues,\n\nOn behalf of ${p.partnerName}, I am sending the signed letter of commitment.\n\nResearch Office\n${p.partnerOrg}`,
    date: day(34 + (i % 4), 22, i), attachments: [loc(p)],
  });
}

// 18: 개인 메일(gmail) + 서명에 기관명, 제목에 과제명 일부
{
  const p = projects[18];
  add(`${p.id}_gmail.eml`, {
    fromName: p.partnerName, from: "personal.researcher@gmail.com",
    subject: `Re: ${p.name.split(" ").slice(0, 4).join(" ")} 협약서`,
    body: `Hi,\n\nSorry for sending from my personal account. Attached is the signed agreement.\n\n--\n${p.partnerName}\n${p.partnerOrg}`,
    date: day(36, 8, 15), attachments: [{ ...agr(p), name: "signed_agreement.pdf" }],
  });
}

// 26, 27: 같은 해외기관(Nordlicht) 공용 주소 → 후보 2개
{
  const p = projects[26];
  add(`nordlicht_shared.eml`, {
    fromName: "Nordlicht Grants Office", from: `grants@${p.partnerDomain}`,
    subject: "Signed Letter of Commitment",
    body: "Dear KIAT,\n\nPlease find our signed letter of commitment attached.\n\nGrants Office\nNordlicht Institute of Technology",
    date: day(37, 19, 40), attachments: [loc(p)],
  });
}

// 답장 인용부에 다른 과제번호가 있는 경우 (인용부는 무시해야 함)
{
  const p = projects[19];
  const other = projects[3];
  add(`${p.id}_reply.eml`, {
    fromName: p.partnerName, from: p.partnerEmail,
    subject: `RE: [${p.id}] 협약서 서명본 요청`,
    body: `Dear Kim,\n\nHere is the signed agreement as requested.\n\nBest,\n${p.partnerName}\n\n-----Original Message-----\nFrom: KIAT\nSubject: ${other.id} 관련 문의\n> 예전 메일 인용: ${other.id}`,
    date: day(38, 15, 0), attachments: [agr(p)],
  });
}

// 단서가 거의 없는 서류 메일 → 미분류
add("unknown_scan.eml", {
  fromName: "scanner", from: "noreply-scan@printhub.example.net",
  subject: "Scanned document",
  body: "Please find the attached documents.",
  date: day(35, 11, 11),
  attachments: [{ name: "scan_0012.pdf", data: fakePdf("Scan", ["(unreadable scan)"]) }],
});

// 업무와 무관한 메일 → 대상 아님
const noise = [
  ["뉴스레터", "news@techweekly.example.com", "Tech Weekly - December highlights", "Top stories this week: AI chips, battery recycling, and more."],
  ["세미나 안내", "event@forum.example.org", "[초대] 2026 산업기술 국제 포럼 등록 안내", "포럼 등록 페이지에서 사전 등록해 주세요."],
  ["Out of office", "a.smith@vendor.example.com", "Automatic reply: Out of office", "I am out of the office until January 5."],
  ["사내 공지", "notice@kiat-demo.example.kr", "연말 사무실 대청소 안내", "12월 셋째 주 금요일 오후 대청소를 실시합니다."],
  ["광고", "promo@shop.example.com", "Year-end sale up to 50%", "Don't miss our biggest sale of the year."],
];
noise.forEach(([name, from, subject, body], i) =>
  add(`noise_${i + 1}.eml`, { fromName: name, from, subject, body, date: day(31 + i * 2, 13, i) }),
);

async function writeMails() {
  const zip = new JSZip();
  for (const m of mails) zip.file(m.name, m.content);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(join(OUT, "가상메일.zip"), buf);
}

await writeProjectList();
await writeMails();
console.log(`과제 ${projects.length}개, 메일 ${mails.length}통 생성 → ${OUT}`);

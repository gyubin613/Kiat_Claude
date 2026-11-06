// 공통 자료형

export interface Project {
  /** 과제번호 (과제 목록의 고유값) */
  id: string;
  /** 과제명 */
  name: string;
  /** 주관기관 (국내) */
  leadOrg: string;
  /** 해외 참여기관 */
  partnerOrg: string;
  /** 해외기관 국가 */
  country: string;
  /** 담당자 */
  manager: string;
  /** 연차·연도 등 구분값 */
  year: string;
  /** 연락처 이메일 (주관·해외기관 담당자 등 전체) */
  contacts: string[];
  /** 그중 해외기관 연락처 */
  partnerContacts: string[];
}

export interface MailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  content: Uint8Array;
}

export interface ParsedMail {
  /** 화면·엑셀에서 쓰는 순번 기반 식별자 */
  id: string;
  /** 원본 파일명 (.eml) */
  sourceName: string;
  fromName: string;
  fromAddress: string;
  to: string;
  /** ISO 문자열. 없으면 빈 문자열 */
  date: string;
  subject: string;
  text: string;
  attachments: MailAttachment[];
  /** 원본 .eml 바이트 (폴더 정리 시 함께 보관) */
  raw: Uint8Array;
}

export type DocType = string; // 설정에서 정한 서류 종류 이름 또는 "기타"

export interface Candidate {
  projectId: string;
  score: number;
  reasons: string[];
  /** 과제번호·발신자·도메인 같은 확실한 단서가 있는지 (기관명·과제명 언급만으로는 false) */
  strong: boolean;
}

/** auto: 자동 분류, confirmed: 담당자 확인, review: 확인 필요, unmatched: 미분류, excluded: 대상 아님 */
export type MatchStatus = "auto" | "confirmed" | "review" | "unmatched" | "excluded";

export interface AttachmentResult {
  index: number;
  filename: string;
  docType: DocType;
  docReason: string;
}

export interface MailResult {
  mailId: string;
  /** 업무 대상 메일인지 (필터 2차 판단) */
  relevant: boolean;
  relevanceReason: string;
  projectId: string | null;
  confidence: number;
  status: MatchStatus;
  reasons: string[];
  candidates: Candidate[];
  attachments: AttachmentResult[];
  /** 본문 요약 (AI 사용 시) 또는 본문 앞부분 */
  summary: string;
  /** 담당자가 직접 고쳤는지 */
  edited: boolean;
  /** AI 판단을 받았는지 */
  aiAssisted: boolean;
}

export interface Settings {
  /** 과제별로 받아야 하는 서류 종류 */
  requiredDocs: string[];
  /** 서류 종류별 인식 키워드 */
  docKeywords: Record<string, string[]>;
  /** 업무 메일 판단 키워드 (제목·본문·첨부명) */
  relevanceKeywords: string[];
  /** 자동 확정 기준 점수 */
  autoThreshold: number;
  /** 확인 필요 기준 점수 (이보다 낮으면 미분류) */
  reviewThreshold: number;
}

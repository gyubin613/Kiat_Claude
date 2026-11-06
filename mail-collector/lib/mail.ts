import PostalMime from "postal-mime";
import JSZip from "jszip";
import type { MailAttachment, ParsedMail } from "./types";

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** 서명 이미지 같은 본문 삽입 이미지는 제출 서류에서 제외 */
function isInlineDecoration(a: { disposition?: string | null; mimeType: string; related?: boolean }): boolean {
  return (a.disposition === "inline" || !!a.related) && a.mimeType.startsWith("image/");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export async function parseEml(bytes: Uint8Array, sourceName: string, id: string): Promise<ParsedMail> {
  const email = await PostalMime.parse(bytes);
  const attachments: MailAttachment[] = [];
  for (const a of email.attachments ?? []) {
    if (isInlineDecoration(a as never)) continue;
    const content = toBytes(a.content as ArrayBuffer | Uint8Array | string);
    attachments.push({
      filename: (a.filename || "첨부파일").normalize("NFC"),
      mimeType: a.mimeType || "application/octet-stream",
      size: content.byteLength,
      content,
    });
  }
  const text = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : "";
  let date = "";
  if (email.date) {
    const d = new Date(email.date);
    if (!Number.isNaN(d.getTime())) date = d.toISOString();
  }
  return {
    id,
    sourceName,
    fromName: email.from?.name || "",
    fromAddress: (email.from?.address || "").toLowerCase(),
    to: (email.to ?? []).map((t) => t.address).filter(Boolean).join(", "),
    date,
    subject: (email.subject || "(제목 없음)").normalize("NFC"),
    text,
    attachments,
    raw: bytes,
  };
}

export interface LoadedFile {
  name: string;
  bytes: Uint8Array;
}

/** .eml 파일들과 .eml을 묶은 .zip을 펼쳐서 .eml 목록으로 */
export async function expandMailFiles(files: LoadedFile[]): Promise<{ emls: LoadedFile[]; skipped: string[] }> {
  const emls: LoadedFile[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".eml")) {
      emls.push(f);
    } else if (lower.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(f.bytes);
      const entries = Object.values(zip.files).filter((e) => !e.dir);
      for (const e of entries) {
        if (e.name.toLowerCase().endsWith(".eml")) {
          emls.push({ name: e.name.split("/").pop() || e.name, bytes: await e.async("uint8array") });
        } else if (!e.name.startsWith("__MACOSX")) {
          skipped.push(`${f.name} 안의 ${e.name}`);
        }
      }
    } else {
      skipped.push(f.name);
    }
  }
  return { emls, skipped };
}

export async function parseAll(files: LoadedFile[]): Promise<{ mails: ParsedMail[]; errors: string[]; skipped: string[] }> {
  const { emls, skipped } = await expandMailFiles(files);
  const mails: ParsedMail[] = [];
  const errors: string[] = [];
  let n = 0;
  for (const f of emls) {
    try {
      n += 1;
      mails.push(await parseEml(f.bytes, f.name, `M${String(n).padStart(3, "0")}`));
    } catch (e) {
      errors.push(`${f.name}: 메일을 읽지 못했습니다 (${(e as Error).message})`);
    }
  }
  mails.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  mails.forEach((m, i) => (m.id = `M${String(i + 1).padStart(3, "0")}`));
  return { mails, errors, skipped };
}

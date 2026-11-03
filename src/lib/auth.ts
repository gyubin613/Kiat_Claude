// 관리자 세션: HMAC-SHA256 서명 쿠키 (Edge 미들웨어·Node 라우트 모두에서 동작하도록 Web Crypto 사용)

export const SESSION_COOKIE = "kiat_admin";
const SESSION_HOURS = 12;

const DEV_PASSWORD = "demo1234";

export function adminPassword(): string | null {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  // 운영(배포) 환경에서는 기본 비밀번호를 허용하지 않는다.
  if (process.env.NODE_ENV !== "production") return DEV_PASSWORD;
  return null;
}

export function usingDevPassword() {
  return !process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== "production";
}

function secret(): string {
  return process.env.SESSION_SECRET || `kiat-session::${adminPassword() ?? "unset"}`;
}

const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let s = "";
  sig.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function createSession(): Promise<{ value: string; maxAge: number }> {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = `admin.${exp}`;
  return { value: `${payload}.${await hmac(payload)}`, maxAge: SESSION_HOURS * 3600 };
}

export async function verifySession(value: string | undefined | null): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(parts[2], await hmac(`${parts[0]}.${parts[1]}`));
}

export async function checkPassword(input: string): Promise<boolean> {
  const pw = adminPassword();
  if (!pw) return false;
  // 길이 노출을 줄이기 위해 해시 비교
  const [a, b] = await Promise.all([hmac(`pw:${input}`), hmac(`pw:${pw}`)]);
  return safeEqual(a, b);
}

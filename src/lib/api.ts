import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError } from "./repo";
import { firstError } from "./validate";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.message, ...e.extra }, e.status);
      if (e instanceof ZodError) return json({ error: firstError(e), issues: e.issues }, 400);
      console.error(e);
      return json({ error: "서버 처리 중 오류가 발생했습니다." }, 500);
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError(400, "요청 형식이 올바르지 않습니다.");
  }
  return schema.parse(raw);
}

export function baseUrl(req: Request) {
  return (process.env.APP_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
}

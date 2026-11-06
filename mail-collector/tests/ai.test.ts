import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeAiResult, type AiClassifyRequest } from "../lib/ai/classify";
import { POST } from "../app/api/ai/classify/route";
import { aiConfig } from "../lib/ai/provider";

const req: AiClassifyRequest = {
  mail: { subject: "LOC", fromName: "A", fromAddress: "a@x.example", date: "", body: "hi", attachments: ["a.pdf", "b.pdf"] },
  candidates: [
    { id: "P1", name: "과제1", leadOrg: "가", partnerOrg: "X", country: "DE" },
    { id: "P2", name: "과제2", leadOrg: "나", partnerOrg: "Y", country: "FR" },
  ],
  docTypes: ["참여확약서", "협약서"],
};

describe("AI 결과 검증", () => {
  it("후보에 없는 과제번호와 없는 서류 종류는 버린다", () => {
    const r = sanitizeAiResult({ projectId: "P999", confidence: 99, reason: "x", summary: "y", attachmentTypes: ["참여확약서", "영수증"] }, req);
    expect(r.projectId).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.attachmentTypes).toEqual(["참여확약서", "기타"]);
  });
  it("정상 결과는 그대로", () => {
    const r = sanitizeAiResult({ projectId: "P2", confidence: 88, reason: "r", summary: "s", attachmentTypes: ["협약서"] }, req);
    expect(r).toMatchObject({ projectId: "P2", confidence: 88, attachmentTypes: ["협약서", "기타"] });
  });
});

describe("내부 모델 서버(OpenAI 호환)로 전환", () => {
  let server: ReturnType<typeof createServer>;
  let seen: { model?: string; messages?: { content: string }[] } = {};
  beforeAll(async () => {
    server = createServer((rq, rs) => {
      let b = "";
      rq.on("data", (c) => (b += c));
      rq.on("end", () => {
        seen = JSON.parse(b);
        rs.setHeader("Content-Type", "application/json");
        rs.end(
          JSON.stringify({
            choices: [{ message: { content: '{"projectId":"P1","confidence":90,"reason":"발신 기관 일치","summary":"확약서 제출","attachmentTypes":["참여확약서","기타"]}' } }],
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    process.env.AI_PROVIDER = "internal";
    process.env.AI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    process.env.AI_MODEL = "local-test-model";
  });
  afterAll(() => {
    server.close();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
  });

  it("환경변수만 바꾸면 같은 API가 내부 모델을 쓴다", async () => {
    expect(aiConfig().provider).toBe("internal");
    const res = await POST(new Request("http://x/api/ai/classify", { method: "POST", body: JSON.stringify(req) }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.projectId).toBe("P1");
    expect(data.attachmentTypes).toEqual(["참여확약서", "기타"]);
    expect(seen.model).toBe("local-test-model");
    expect(seen.messages?.[1].content).toContain("P1 | 과제1");
  });

  it("비밀번호를 설정하면 없는 요청은 막는다", async () => {
    process.env.APP_PASSWORD = "pw";
    const res = await POST(new Request("http://x/api/ai/classify", { method: "POST", body: JSON.stringify(req) }));
    expect(res.status).toBe(401);
    delete process.env.APP_PASSWORD;
  });
});

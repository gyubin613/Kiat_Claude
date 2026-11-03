// Upstash REST 호환 서버가 있을 때만 실행: REDIS_TEST_URL=http://localhost:8079 npm test
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.REDIS_TEST_URL;

describe.skipIf(!url)("Redis 저장소 (통합)", () => {
  beforeAll(async () => {
    process.env.UPSTASH_REDIS_REST_URL = url;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test";
    process.env.KV_PREFIX = `test${Date.now()}:`;
    const { __resetKvForTests } = await import("@/lib/store");
    __resetKvForTests();
  });

  it("CAS·SETNX·집합·초기화가 동작한다", async () => {
    const { kv } = await import("@/lib/store");
    const s = kv();
    expect(s.kind).toBe("redis");
    await s.set("doc", { version: 1, v: "a" });
    expect(await s.cas("doc", 1, { version: 2, v: "b" })).toBe("ok");
    expect(await s.cas("doc", 1, { version: 2, v: "c" })).toBe("conflict");
    expect(await s.cas("nope", 1, { version: 2 })).toBe("missing");
    expect(await s.get<{ v: string }>("doc")).toMatchObject({ v: "b" });
    expect(await s.setnx("once", { a: 1 })).toBe(true);
    expect(await s.setnx("once", { a: 2 })).toBe(false);
    await s.sadd("set", "x", "y");
    expect((await s.smembers("set")).sort()).toEqual(["x", "y"]);
    expect(await s.mget(["doc", "missing"])).toEqual([{ version: 2, v: "b" }, null]);
    await s.flushPrefix();
    expect(await s.get("doc")).toBeNull();
  });

  it("가상 데이터 전체 시나리오가 Redis에서 동작한다", async () => {
    const { seedDemoData } = await import("@/lib/seed");
    const { listEvaluations, listInvites } = await import("@/lib/repo");
    await seedDemoData();
    const evals = await listEvaluations();
    expect(evals).toHaveLength(3);
    expect(evals.filter((e) => e.status === "finalized")).toHaveLength(1);
    const inviting = evals.find((e) => e.status === "inviting")!;
    expect((await listInvites(inviting.id)).filter((i) => i.response)).toHaveLength(6);
    const { kv } = await import("@/lib/store");
    await kv().flushPrefix();
  });
});

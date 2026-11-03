import { Redis } from "@upstash/redis";

/**
 * 키-값 저장소 추상화.
 * - Upstash Redis 환경변수가 있으면 Redis 사용 (Vercel 운영)
 * - 없으면 프로세스 메모리 사용 (로컬 개발·시연용, 재시작 시 초기화)
 */
export type CasResult = "ok" | "conflict" | "missing";

export interface KV {
  readonly kind: "redis" | "memory";
  get<T>(key: string): Promise<T | null>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  set<T>(key: string, value: T): Promise<void>;
  /** 키가 없을 때만 저장. 저장되면 true */
  setnx<T>(key: string, value: T): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  sadd(key: string, ...members: string[]): Promise<void>;
  srem(key: string, ...members: string[]): Promise<void>;
  smembers(key: string): Promise<string[]>;
  /** value.version 이 expectedVersion 과 같을 때만 교체 (낙관적 동시성 제어) */
  cas<T extends { version: number }>(key: string, expectedVersion: number, value: T): Promise<CasResult>;
  flushPrefix(): Promise<void>;
}

const PREFIX = process.env.KV_PREFIX || "kiat:";
const k = (key: string) => PREFIX + key;

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return -1 end
local ok, obj = pcall(cjson.decode, cur)
if not ok then return -2 end
if tonumber(obj['version']) ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

class RedisKV implements KV {
  readonly kind = "redis" as const;
  constructor(private r: Redis) {}
  async get<T>(key: string) {
    return (await this.r.get<T>(k(key))) ?? null;
  }
  async mget<T>(keys: string[]) {
    if (keys.length === 0) return [];
    const out: (T | null)[] = [];
    // 대량 조회 시 요청 크기 제한을 피하기 위해 나눠서 조회
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200).map(k);
      const res = await this.r.mget<(T | null)[]>(...chunk);
      out.push(...res.map((v) => v ?? null));
    }
    return out;
  }
  async set<T>(key: string, value: T) {
    await this.r.set(k(key), JSON.stringify(value));
  }
  async setnx<T>(key: string, value: T) {
    const res = await this.r.set(k(key), JSON.stringify(value), { nx: true });
    return res === "OK";
  }
  async del(...keys: string[]) {
    if (keys.length) await this.r.del(...keys.map(k));
  }
  async sadd(key: string, ...members: string[]) {
    if (members.length) await this.r.sadd(k(key), members[0], ...members.slice(1));
  }
  async srem(key: string, ...members: string[]) {
    if (members.length) await this.r.srem(k(key), ...members);
  }
  async smembers(key: string) {
    return (await this.r.smembers(k(key))) as string[];
  }
  async cas<T extends { version: number }>(key: string, expectedVersion: number, value: T): Promise<CasResult> {
    const res = await this.r.eval(CAS_SCRIPT, [k(key)], [String(expectedVersion), JSON.stringify(value)]);
    if (res === 1) return "ok";
    if (res === 0) return "conflict";
    return "missing";
  }
  async flushPrefix() {
    let cursor: string | number = 0;
    do {
      const [next, keys]: [string | number, string[]] = await this.r.scan(cursor, { match: PREFIX + "*", count: 500 });
      if (keys.length) await this.r.del(...keys);
      cursor = next;
    } while (String(cursor) !== "0");
  }
}

type MemState = { kv: Map<string, string>; sets: Map<string, Set<string>> };

class MemoryKV implements KV {
  readonly kind = "memory" as const;
  private s: MemState;
  constructor() {
    const g = globalThis as unknown as { __kiatMem?: MemState };
    g.__kiatMem ??= { kv: new Map(), sets: new Map() };
    this.s = g.__kiatMem;
  }
  async get<T>(key: string) {
    const v = this.s.kv.get(k(key));
    return v === undefined ? null : (JSON.parse(v) as T);
  }
  async mget<T>(keys: string[]) {
    return Promise.all(keys.map((key) => this.get<T>(key)));
  }
  async set<T>(key: string, value: T) {
    this.s.kv.set(k(key), JSON.stringify(value));
  }
  async setnx<T>(key: string, value: T) {
    if (this.s.kv.has(k(key))) return false;
    this.s.kv.set(k(key), JSON.stringify(value));
    return true;
  }
  async del(...keys: string[]) {
    for (const key of keys) {
      this.s.kv.delete(k(key));
      this.s.sets.delete(k(key));
    }
  }
  async sadd(key: string, ...members: string[]) {
    const set = this.s.sets.get(k(key)) ?? new Set<string>();
    members.forEach((m) => set.add(m));
    this.s.sets.set(k(key), set);
  }
  async srem(key: string, ...members: string[]) {
    const set = this.s.sets.get(k(key));
    members.forEach((m) => set?.delete(m));
  }
  async smembers(key: string) {
    return [...(this.s.sets.get(k(key)) ?? [])];
  }
  async cas<T extends { version: number }>(key: string, expectedVersion: number, value: T): Promise<CasResult> {
    const cur = this.s.kv.get(k(key));
    if (cur === undefined) return "missing";
    if ((JSON.parse(cur) as { version: number }).version !== expectedVersion) return "conflict";
    this.s.kv.set(k(key), JSON.stringify(value));
    return "ok";
  }
  async flushPrefix() {
    this.s.kv.clear();
    this.s.sets.clear();
  }
}

let instance: KV | null = null;

export function redisConfigured() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  );
}

export function kv(): KV {
  if (instance) return instance;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  instance = url && token ? new RedisKV(new Redis({ url, token })) : new MemoryKV();
  return instance;
}

/** 테스트용 */
export function __resetKvForTests() {
  instance = null;
  (globalThis as unknown as { __kiatMem?: MemState }).__kiatMem = undefined;
}

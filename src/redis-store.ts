import type { Redis } from "ioredis";
import type { TaskRecord } from "./types.js";

export type Bucket = "PENDING" | "FINISH" | "FAILED" | "CANCELED";

export interface RedisStoreOptions {
  /**
   * Optional TTL in **seconds** applied to records written/moved into the FINISH bucket.
   * `undefined` or `0` disables the TTL — FINISH records are kept indefinitely.
   * Other buckets (PENDING / FAILED / CANCELED) are never affected.
   */
  finishTtlSeconds?: number;
}

export class RedisStore {
  private readonly finishTtlSeconds: number;

  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
    options: RedisStoreOptions = {}
  ) {
    const ttl = options.finishTtlSeconds ?? 0;
    this.finishTtlSeconds = Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0;
  }

  private key(bucket: Bucket, id: number) {
    return `${this.namespace}:${bucket}:task-${String(id)}`;
  }

  private pattern(bucket: Bucket) {
    return `${this.namespace}:${bucket}:task-*`;
  }

  private ttlFor(bucket: Bucket) {
    return bucket === "FINISH" ? this.finishTtlSeconds : 0;
  }

  async nextId() {
    return await this.redis.incr(`${this.namespace}:counter`);
  }

  async write(bucket: Bucket, record: TaskRecord) {
    const payload = JSON.stringify(record);
    const ttl = this.ttlFor(bucket);
    if (ttl > 0) {
      await this.redis.set(this.key(bucket, record.id), payload, "EX", ttl);
    } else {
      await this.redis.set(this.key(bucket, record.id), payload);
    }
  }

  async read(bucket: Bucket, id: number) {
    const raw = await this.redis.get(this.key(bucket, id));
    return raw ? this.parse(raw) : null;
  }

  async move(from: Bucket, to: Bucket, record: TaskRecord) {
    const payload = JSON.stringify(record);
    const ttl = this.ttlFor(to);
    const pipeline = this.redis.multi();
    if (ttl > 0) {
      pipeline.set(this.key(to, record.id), payload, "EX", ttl);
    } else {
      pipeline.set(this.key(to, record.id), payload);
    }
    pipeline.del(this.key(from, record.id));
    await pipeline.exec();
  }

  async list(bucket: Bucket) {
    const records: TaskRecord[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", this.pattern(bucket), "COUNT", 200);
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.redis.mget(...keys);
      for (const value of values) {
        if (value === null) continue;
        const parsed = this.parse(value);
        if (parsed) records.push(parsed);
      }
    } while (cursor !== "0");
    records.sort((a, b) => a.id - b.id);
    return records;
  }

  private parse(raw: string) {
    try {
      return JSON.parse(raw) as TaskRecord;
    } catch {
      return null;
    }
  }
}

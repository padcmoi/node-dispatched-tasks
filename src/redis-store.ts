import type { Redis } from "ioredis";
import type { TaskRecord } from "./types.js";

export type Bucket = "PENDING" | "FINISH" | "FAILED" | "CANCELED";

export class RedisStore {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string
  ) {}

  private key(bucket: Bucket, id: number) {
    return `${this.namespace}:${bucket}:task-${String(id)}`;
  }

  private pattern(bucket: Bucket) {
    return `${this.namespace}:${bucket}:task-*`;
  }

  async nextId() {
    return await this.redis.incr(`${this.namespace}:counter`);
  }

  async write(bucket: Bucket, record: TaskRecord) {
    await this.redis.set(this.key(bucket, record.id), JSON.stringify(record));
  }

  async read(bucket: Bucket, id: number) {
    const raw = await this.redis.get(this.key(bucket, id));
    return raw ? this.parse(raw) : null;
  }

  async move(from: Bucket, to: Bucket, record: TaskRecord) {
    const pipeline = this.redis.multi();
    pipeline.set(this.key(to, record.id), JSON.stringify(record));
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

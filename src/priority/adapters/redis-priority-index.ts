import type { Redis } from "ioredis";
import type { PriorityIndex, ReadyClaim } from "../priority-index.interface.js";

export interface RedisPriorityIndexOptions {
  redis: Redis;
  namespace?: string;
}

const DEFAULT_NAMESPACE = "dispatched-tasks";

export class RedisPriorityIndex implements PriorityIndex {
  private readonly redis: Redis;
  private readonly ns: string;

  constructor(options: RedisPriorityIndexOptions) {
    this.redis = options.redis;
    this.ns = options.namespace ?? DEFAULT_NAMESPACE;
  }

  private key(suffix: string) {
    return `${this.ns}:${suffix}`;
  }

  private readyKey() {
    return this.key("queue");
  }

  private delayedKey() {
    return this.key("delayed");
  }

  private idempotencyKey(key: string) {
    return this.key(`idempotency:${key}`);
  }

  private runningKey() {
    return this.key("running");
  }

  async enqueueReady(publicId: string, score: number) {
    await this.redis.zadd(this.readyKey(), score, publicId);
  }

  async enqueueDelayed(publicId: string, scheduledAtMs: number) {
    await this.redis.zadd(this.delayedKey(), scheduledAtMs, publicId);
  }

  async popReady() {
    const popped = await this.redis.zpopmin(this.readyKey(), 1);
    if (!popped || popped.length < 2) return null;
    const publicId = popped[0];
    const scoreStr = popped[1];
    const score = Number(scoreStr);
    if (typeof publicId !== "string" || Number.isNaN(score)) return null;
    const claim: ReadyClaim = { publicId, score };
    return claim;
  }

  async removeReady(publicId: string) {
    await this.redis.zrem(this.readyKey(), publicId);
  }

  async promoteDueDelayed(nowMs: number) {
    const due = await this.redis.zrangebyscore(this.delayedKey(), 0, nowMs, "LIMIT", 0, 200);
    if (due.length === 0) return 0;
    const pipeline = this.redis.pipeline();
    for (const publicId of due) {
      pipeline.zadd(this.readyKey(), nowMs, publicId);
      pipeline.zrem(this.delayedKey(), publicId);
    }
    await pipeline.exec();
    return due.length;
  }

  async acquireIdempotency(key: string, publicId: string, ttlSeconds: number) {
    const setResult = await this.redis.set(this.idempotencyKey(key), publicId, "EX", ttlSeconds, "NX");
    if (setResult === "OK") return publicId;
    const owner = await this.redis.get(this.idempotencyKey(key));
    return owner ?? publicId;
  }

  async getIdempotencyOwner(key: string) {
    return this.redis.get(this.idempotencyKey(key));
  }

  async trackRunning(publicId: string, ttlSeconds: number) {
    await this.redis.set(this.key(`running:${publicId}`), "1", "EX", ttlSeconds);
    await this.redis.sadd(this.runningKey(), publicId);
  }

  async untrackRunning(publicId: string) {
    await this.redis.del(this.key(`running:${publicId}`));
    await this.redis.srem(this.runningKey(), publicId);
  }

  async countReady() {
    return this.redis.zcard(this.readyKey());
  }

  async countDelayed() {
    return this.redis.zcard(this.delayedKey());
  }
}

import type { PriorityIndex, ReadyClaim } from "../../src/priority/priority-index.interface.js";

interface Entry {
  publicId: string;
  score: number;
}

export class InMemoryPriorityIndex implements PriorityIndex {
  private readonly ready: Entry[] = [];
  private readonly delayed: Entry[] = [];
  private readonly idempotency = new Map<string, string>();
  private readonly running = new Set<string>();

  enqueueReady(publicId: string, score: number) {
    this.ready.push({ publicId, score });
    this.ready.sort((a, b) => a.score - b.score);
    return Promise.resolve();
  }

  enqueueDelayed(publicId: string, scheduledAtMs: number) {
    this.delayed.push({ publicId, score: scheduledAtMs });
    this.delayed.sort((a, b) => a.score - b.score);
    return Promise.resolve();
  }

  popReady() {
    const head = this.ready.shift();
    if (!head) return Promise.resolve(null);
    const claim: ReadyClaim = { publicId: head.publicId, score: head.score };
    return Promise.resolve(claim);
  }

  removeReady(publicId: string) {
    const idx = this.ready.findIndex((e) => e.publicId === publicId);
    if (idx >= 0) this.ready.splice(idx, 1);
    return Promise.resolve();
  }

  promoteDueDelayed(nowMs: number) {
    let count = 0;
    while (this.delayed.length > 0 && this.delayed[0].score <= nowMs) {
      const head = this.delayed.shift();
      if (!head) break;
      this.ready.push({ publicId: head.publicId, score: nowMs });
      count++;
    }
    if (count > 0) this.ready.sort((a, b) => a.score - b.score);
    return Promise.resolve(count);
  }

  acquireIdempotency(key: string, publicId: string, _ttlSeconds: number) {
    const existing = this.idempotency.get(key);
    if (existing) return Promise.resolve(existing);
    this.idempotency.set(key, publicId);
    return Promise.resolve(publicId);
  }

  getIdempotencyOwner(key: string) {
    return Promise.resolve(this.idempotency.get(key) ?? null);
  }

  trackRunning(publicId: string, _ttlSeconds: number) {
    this.running.add(publicId);
    return Promise.resolve();
  }

  untrackRunning(publicId: string) {
    this.running.delete(publicId);
    return Promise.resolve();
  }

  countReady() {
    return Promise.resolve(this.ready.length);
  }

  countDelayed() {
    return Promise.resolve(this.delayed.length);
  }
}

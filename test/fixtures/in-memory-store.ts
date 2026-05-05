import type { TaskStore } from "../../src/store/task-store.interface.js";
import type { NewTaskRecord, TaskListFilters, TaskRecord } from "../../src/core/types.js";

export class InMemoryTaskStore implements TaskStore {
  private readonly byPublicId = new Map<string, TaskRecord>();
  private nextId = 1;

  insert(input: NewTaskRecord) {
    const id = String(this.nextId++);
    const now = new Date();
    const record: TaskRecord = {
      id,
      publicId: input.publicId,
      code: input.code,
      payload: input.payload,
      weight: input.weight,
      status: "pending",
      priority: input.priority,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      scheduledAt: input.scheduledAt,
      claimedAt: null,
      claimedBy: null,
      startedAt: null,
      completedAt: null,
      lastError: null,
      source: input.source,
      sourceMeta: input.sourceMeta,
      callback: input.callback,
      result: null,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    this.byPublicId.set(input.publicId, record);
    return Promise.resolve(clone(record));
  }

  getByPublicId(publicId: string) {
    const found = this.byPublicId.get(publicId);
    return Promise.resolve(found ? clone(found) : null);
  }

  getByIdempotencyKey(key: string) {
    for (const r of this.byPublicId.values()) {
      if (r.idempotencyKey === key) return Promise.resolve(clone(r));
    }
    return Promise.resolve(null);
  }

  claim(publicId: string, claimedBy: string) {
    const r = this.byPublicId.get(publicId);
    if (!r) return Promise.resolve(null);
    if (r.status !== "pending" && r.status !== "failed") return Promise.resolve(null);
    r.status = "claimed";
    r.claimedAt = new Date();
    r.claimedBy = claimedBy;
    r.attempts += 1;
    r.updatedAt = new Date();
    return Promise.resolve(clone(r));
  }

  markStarted(publicId: string) {
    const r = this.byPublicId.get(publicId);
    if (r) {
      r.status = "running";
      r.startedAt = new Date();
      r.updatedAt = new Date();
    }
    return Promise.resolve();
  }

  markSucceeded(publicId: string, result: unknown) {
    const r = this.byPublicId.get(publicId);
    if (r) {
      r.status = "succeeded";
      r.completedAt = new Date();
      r.result = result;
      r.lastError = null;
      r.updatedAt = new Date();
    }
    return Promise.resolve();
  }

  markFailed(publicId: string, error: string, willRetry: boolean) {
    const r = this.byPublicId.get(publicId);
    if (r) {
      r.status = willRetry ? "failed" : "dead";
      r.lastError = error;
      if (!willRetry) r.completedAt = new Date();
      r.updatedAt = new Date();
    }
    return Promise.resolve();
  }

  resetForRetry(publicId: string, scheduledAt: Date | null) {
    const r = this.byPublicId.get(publicId);
    if (!r) return Promise.resolve(null);
    r.status = "pending";
    r.scheduledAt = scheduledAt;
    r.claimedAt = null;
    r.claimedBy = null;
    r.startedAt = null;
    r.completedAt = null;
    r.updatedAt = new Date();
    return Promise.resolve(clone(r));
  }

  cancel(publicId: string) {
    const r = this.byPublicId.get(publicId);
    if (!r) return Promise.resolve(null);
    if (r.status !== "pending" && r.status !== "failed") return Promise.resolve(null);
    r.status = "cancelled";
    r.completedAt = new Date();
    r.updatedAt = new Date();
    return Promise.resolve(clone(r));
  }

  list(filters: TaskListFilters) {
    let arr = Array.from(this.byPublicId.values());
    if (filters.status) {
      const want = Array.isArray(filters.status) ? filters.status : [filters.status];
      arr = arr.filter((r) => want.includes(r.status));
    }
    if (filters.code) arr = arr.filter((r) => r.code === filters.code);
    if (filters.correlationId) arr = arr.filter((r) => r.correlationId === filters.correlationId);
    const fromCreatedAt = filters.fromCreatedAt;
    const toCreatedAt = filters.toCreatedAt;
    if (fromCreatedAt) arr = arr.filter((r) => r.createdAt >= fromCreatedAt);
    if (toCreatedAt) arr = arr.filter((r) => r.createdAt <= toCreatedAt);
    arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return Promise.resolve(arr.slice(offset, offset + limit).map(clone));
  }

  pendingOrRunning() {
    const arr = Array.from(this.byPublicId.values())
      .filter((r) => r.status === "pending" || r.status === "claimed" || r.status === "running" || r.status === "failed")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
    return Promise.resolve(arr);
  }
}

function clone(record: TaskRecord) {
  const cloned: TaskRecord = {
    ...record,
    scheduledAt: record.scheduledAt ? new Date(record.scheduledAt) : null,
    claimedAt: record.claimedAt ? new Date(record.claimedAt) : null,
    startedAt: record.startedAt ? new Date(record.startedAt) : null,
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    sourceMeta: record.sourceMeta ? { ...record.sourceMeta } : null,
    callback: record.callback ? { ...record.callback } : null,
  };
  return cloned;
}

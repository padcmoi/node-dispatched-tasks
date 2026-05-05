import { Scheduler } from "./scheduler.js";
import { TaskRegistry } from "./task-registry.js";
import { ulid } from "./ulid.js";
import { TaskNotFoundError } from "./errors.js";
import { validatePayload } from "../validation/zod-validate.js";
import type { PriorityIndex } from "../priority/priority-index.interface.js";
import type { TaskStore } from "../store/task-store.interface.js";
import type { Logger, NewTaskRecord, TaskDefinition, TaskListFilters, TaskSource } from "./types.js";

export interface SchedulerConfig {
  enabled: boolean;
  pollIntervalMs?: number;
  promoteIntervalMs?: number;
  maxConcurrentTasks?: number;
  maxConcurrentWeight?: number;
}

export interface DispatchedTaskServiceOptions {
  store: TaskStore;
  priority: PriorityIndex;
  workerId: string;
  scheduler?: SchedulerConfig;
  logger?: Logger;
  idempotencyTtlSeconds?: number;
}

export interface EnqueueInput {
  code: string;
  payload?: unknown;
  source?: TaskSource;
  sourceMeta?: Record<string, unknown> | null;
  callback?: Record<string, unknown> | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  scheduledAt?: Date | null;
  weight?: number;
  priority?: number | null;
  maxAttempts?: number;
}

const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export class DispatchedTaskService {
  private readonly store: TaskStore;
  private readonly priority: PriorityIndex;
  private readonly registry = new TaskRegistry();
  private readonly scheduler: Scheduler | null;
  private readonly logger: Logger;
  private readonly idempotencyTtlSeconds: number;
  private started = false;

  constructor(options: DispatchedTaskServiceOptions) {
    this.store = options.store;
    this.priority = options.priority;
    this.logger = options.logger ?? createNoopLogger();
    this.idempotencyTtlSeconds = options.idempotencyTtlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;
    if (options.scheduler && options.scheduler.enabled) {
      this.scheduler = new Scheduler({
        store: options.store,
        priority: options.priority,
        registry: this.registry,
        workerId: options.workerId,
        pollIntervalMs: options.scheduler.pollIntervalMs,
        promoteIntervalMs: options.scheduler.promoteIntervalMs,
        maxConcurrentTasks: options.scheduler.maxConcurrentTasks,
        maxConcurrentWeight: options.scheduler.maxConcurrentWeight,
        logger: this.logger,
      });
    } else {
      this.scheduler = null;
    }
  }

  register<TPayload, TResult>(definition: TaskDefinition<TPayload, TResult>) {
    this.registry.register(definition);
  }

  has(code: string) {
    return this.registry.has(code);
  }

  listRegisteredCodes() {
    return this.registry.list().map((t) => t.code);
  }

  async enqueue(input: EnqueueInput) {
    const handler = this.registry.tryGet(input.code);
    const weight = input.weight ?? handler?.weight ?? 1;
    const maxAttempts = input.maxAttempts ?? handler?.maxAttempts ?? 3;
    if (handler?.inputSchema) {
      validatePayload(handler.inputSchema, input.payload);
    }
    if (input.idempotencyKey) {
      const existing = await this.store.getByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    const publicId = ulid();
    const newRecord: NewTaskRecord = {
      publicId,
      code: input.code,
      payload: input.payload ?? null,
      weight,
      maxAttempts,
      scheduledAt: input.scheduledAt ?? null,
      source: input.source ?? "internal",
      sourceMeta: input.sourceMeta ?? null,
      callback: input.callback ?? null,
      correlationId: input.correlationId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      priority: input.priority ?? null,
    };

    const record = await this.store.insert(newRecord);

    if (input.idempotencyKey) {
      const owner = await this.priority.acquireIdempotency(input.idempotencyKey, record.publicId, this.idempotencyTtlSeconds);
      if (owner !== record.publicId) {
        const existing = await this.store.getByIdempotencyKey(input.idempotencyKey);
        if (existing && existing.publicId !== record.publicId) {
          await this.store.cancel(record.publicId);
          return existing;
        }
      }
    }

    if (record.scheduledAt && record.scheduledAt.getTime() > Date.now()) {
      await this.priority.enqueueDelayed(record.publicId, record.scheduledAt.getTime());
    } else {
      const score = computeReadyScore(record.priority, record.createdAt.getTime());
      await this.priority.enqueueReady(record.publicId, score);
    }

    this.logger.info("[dispatched-tasks] enqueued", {
      publicId: record.publicId,
      code: record.code,
      weight: record.weight,
      scheduledAt: record.scheduledAt ? record.scheduledAt.toISOString() : null,
    });
    return record;
  }

  async get(publicId: string) {
    return this.store.getByPublicId(publicId);
  }

  async list(filters: TaskListFilters = {}) {
    return this.store.list(filters);
  }

  async retry(publicId: string) {
    const record = await this.store.getByPublicId(publicId);
    if (!record) throw new TaskNotFoundError(publicId);
    const reset = await this.store.resetForRetry(publicId, null);
    if (!reset) return null;
    const score = computeReadyScore(reset.priority, Date.now());
    await this.priority.enqueueReady(publicId, score);
    this.logger.info("[dispatched-tasks] retry requested", { publicId, code: record.code });
    return reset;
  }

  async cancel(publicId: string) {
    const cancelled = await this.store.cancel(publicId);
    if (cancelled) {
      await this.priority.removeReady(publicId);
      this.logger.info("[dispatched-tasks] cancelled", { publicId });
    }
    return cancelled;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.recoverPendingOrRunning();
    if (this.scheduler) {
      this.scheduler.start();
      this.logger.info("[dispatched-tasks] scheduler started");
    } else {
      this.logger.info("[dispatched-tasks] service started in producer-only mode (no scheduler)");
    }
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    if (this.scheduler) {
      await this.scheduler.stop();
      this.logger.info("[dispatched-tasks] scheduler stopped");
    }
  }

  private async recoverPendingOrRunning() {
    const tasks = await this.store.pendingOrRunning();
    if (tasks.length === 0) return;
    let readyCount = 0;
    let delayedCount = 0;
    for (const t of tasks) {
      if (t.status === "claimed" || t.status === "running") {
        await this.store.resetForRetry(t.publicId, null);
      }
      if (t.scheduledAt && t.scheduledAt.getTime() > Date.now()) {
        await this.priority.enqueueDelayed(t.publicId, t.scheduledAt.getTime());
        delayedCount++;
      } else {
        const score = computeReadyScore(t.priority, t.createdAt.getTime());
        await this.priority.enqueueReady(t.publicId, score);
        readyCount++;
      }
    }
    this.logger.info("[dispatched-tasks] boot recovery complete", {
      ready: readyCount,
      delayed: delayedCount,
    });
  }
}

function computeReadyScore(priority: number | null, createdAtMs: number) {
  const p = priority ?? 0;
  return -p * 1e13 + createdAtMs;
}

function createNoopLogger() {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
}

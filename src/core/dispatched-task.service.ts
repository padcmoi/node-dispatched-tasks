import { Scheduler } from "./scheduler.js";
import { TaskRegistry } from "./task-registry.js";
import { ulid } from "./ulid.js";
import { TaskNotFoundError } from "./errors.js";
import { validatePayload } from "../validation/zod-validate.js";
import { configureDispatchedTask } from "../store/adapters/dispatched-task.entity.js";
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
  /**
   * Eager TaskStore. Either `store` or `taskStoreFactory` must be provided.
   */
  store?: TaskStore;
  /**
   * Lazy TaskStore factory. Resolved on the first call to `start()`, AFTER any TypeORM DataSource
   * has been initialized. Use this when you want the lib's service constructor to run before
   * `DataSource.initialize()` so that `tableName` (below) takes effect.
   */
  taskStoreFactory?: () => TaskStore;
  priority: PriorityIndex;
  workerId: string;
  /**
   * Optional override for the SQL table name of `DispatchedTask` (and its index names).
   * Applied via `configureDispatchedTask` inside the service constructor — meaning the constructor
   * must run BEFORE `DataSource.initialize()` for it to take effect.
   *
   * If omitted or empty, the default `dispatched_task` is used.
   */
  tableName?: string;
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
  private store: TaskStore | null;
  private readonly storeFactory: (() => TaskStore) | null;
  private readonly priority: PriorityIndex;
  private readonly registry = new TaskRegistry();
  private readonly schedulerOptions: SchedulerConfig | undefined;
  private readonly schedulerWorkerId: string;
  private scheduler: Scheduler | null = null;
  private readonly logger: Logger;
  private readonly idempotencyTtlSeconds: number;
  private started = false;

  constructor(options: DispatchedTaskServiceOptions) {
    if (options.tableName !== undefined) {
      configureDispatchedTask({ tableName: options.tableName });
    }
    if (options.store && options.taskStoreFactory) {
      throw new Error("DispatchedTaskService: pass either `store` or `taskStoreFactory`, not both.");
    }
    if (!options.store && !options.taskStoreFactory) {
      throw new Error("DispatchedTaskService: either `store` or `taskStoreFactory` must be provided.");
    }
    this.store = options.store ?? null;
    this.storeFactory = options.taskStoreFactory ?? null;
    this.priority = options.priority;
    this.logger = options.logger ?? createNoopLogger();
    this.idempotencyTtlSeconds = options.idempotencyTtlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS;
    this.schedulerOptions = options.scheduler;
    this.schedulerWorkerId = options.workerId;
  }

  private requireStore() {
    if (!this.store) {
      throw new Error("DispatchedTaskService: store not yet resolved. Call start() first.");
    }
    return this.store;
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
    const store = this.requireStore();
    const handler = this.registry.tryGet(input.code);
    const weight = input.weight ?? handler?.weight ?? 1;
    const maxAttempts = input.maxAttempts ?? handler?.maxAttempts ?? 3;
    if (handler?.inputSchema) {
      validatePayload(handler.inputSchema, input.payload);
    }
    if (input.idempotencyKey) {
      const existing = await store.getByIdempotencyKey(input.idempotencyKey);
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

    const record = await store.insert(newRecord);

    if (input.idempotencyKey) {
      const owner = await this.priority.acquireIdempotency(input.idempotencyKey, record.publicId, this.idempotencyTtlSeconds);
      if (owner !== record.publicId) {
        const existing = await store.getByIdempotencyKey(input.idempotencyKey);
        if (existing && existing.publicId !== record.publicId) {
          await store.cancel(record.publicId);
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
    return this.requireStore().getByPublicId(publicId);
  }

  async list(filters: TaskListFilters = {}) {
    return this.requireStore().list(filters);
  }

  async retry(publicId: string) {
    const store = this.requireStore();
    const record = await store.getByPublicId(publicId);
    if (!record) throw new TaskNotFoundError(publicId);
    const reset = await store.resetForRetry(publicId, null);
    if (!reset) return null;
    const score = computeReadyScore(reset.priority, Date.now());
    await this.priority.enqueueReady(publicId, score);
    this.logger.info("[dispatched-tasks] retry requested", { publicId, code: record.code });
    return reset;
  }

  async cancel(publicId: string) {
    const cancelled = await this.requireStore().cancel(publicId);
    if (cancelled) {
      await this.priority.removeReady(publicId);
      this.logger.info("[dispatched-tasks] cancelled", { publicId });
    }
    return cancelled;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    if (!this.store && this.storeFactory) {
      this.store = this.storeFactory();
    }
    if (this.schedulerOptions && this.schedulerOptions.enabled) {
      this.scheduler = new Scheduler({
        store: this.requireStore(),
        priority: this.priority,
        registry: this.registry,
        workerId: this.schedulerWorkerId,
        pollIntervalMs: this.schedulerOptions.pollIntervalMs,
        promoteIntervalMs: this.schedulerOptions.promoteIntervalMs,
        maxConcurrentTasks: this.schedulerOptions.maxConcurrentTasks,
        maxConcurrentWeight: this.schedulerOptions.maxConcurrentWeight,
        logger: this.logger,
      });
    }
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
    const store = this.requireStore();
    const tasks = await store.pendingOrRunning();
    if (tasks.length === 0) return;
    let readyCount = 0;
    let delayedCount = 0;
    for (const t of tasks) {
      if (t.status === "claimed" || t.status === "running") {
        await store.resetForRetry(t.publicId, null);
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

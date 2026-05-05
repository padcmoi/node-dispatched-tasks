import type { Redis } from "ioredis";
import { HandlerNotFoundError } from "./errors.js";
import { RedisStore } from "./redis-store.js";
import { Scheduler } from "./scheduler.js";
import { TaskRegistry } from "./task-registry.js";
import type {
  EnqueueInput,
  Logger,
  ReplayOptions,
  TaskDefinition,
  TaskRecord,
} from "./types.js";

export interface DelayedTaskServiceOptions {
  redis: Redis;
  namespace: string;
  maxTasks?: number;
  pollIntervalMs?: number;
  logger?: Logger;
}

const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class DelayedTaskService {
  private readonly store: RedisStore;
  private readonly registry = new TaskRegistry();
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;
  private readonly namespace: string;
  private readonly maxTasks: number;
  private readonly pollIntervalMs: number;
  private started = false;

  readonly list;

  constructor(options: DelayedTaskServiceOptions) {
    if (!options.redis) {
      throw new Error("DelayedTaskService: 'redis' is required");
    }
    if (typeof options.namespace !== "string" || options.namespace.trim() === "") {
      throw new Error("DelayedTaskService: 'namespace' is required and cannot be empty");
    }
    const maxTasks = options.maxTasks ?? 5;
    if (!Number.isFinite(maxTasks) || maxTasks <= 0) {
      throw new Error("DelayedTaskService: 'maxTasks' must be a positive number");
    }
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new Error("DelayedTaskService: 'pollIntervalMs' must be a positive number");
    }

    this.namespace = options.namespace.trim();
    this.maxTasks = maxTasks;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.store = new RedisStore(options.redis, this.namespace);
    this.scheduler = new Scheduler({
      store: this.store,
      registry: this.registry,
      maxTasks: this.maxTasks,
      pollIntervalMs: this.pollIntervalMs,
      logger: this.logger,
    });

    this.list = {
      pending: () => this.store.list("PENDING"),
      finished: () => this.store.list("FINISH"),
      canceled: () => this.store.list("CANCELED"),
    };
  }

  register(definition: TaskDefinition) {
    this.registry.register(definition);
  }

  has(name: string) {
    return this.registry.has(name);
  }

  async enqueue(input: EnqueueInput) {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      throw new Error("enqueue: 'name' is required");
    }
    if (!this.registry.has(input.name)) {
      throw new HandlerNotFoundError(input.name);
    }
    const definition = this.registry.get(input.name);
    const id = await this.store.nextId();
    const scheduledAtMs = resolveScheduledAt(input.scheduledAt);
    const weight = input.weight ?? definition.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error("enqueue: 'weight' must be a positive number");
    }
    const now = new Date();
    const record: TaskRecord = {
      id,
      name: input.name,
      data: input.data ?? null,
      scheduledAt: new Date(scheduledAtMs).toISOString(),
      scheduledAtMs,
      weight,
      status: "pending",
      attempts: 0,
      createdAt: now.toISOString(),
      startedAt: null,
      finishedAt: null,
      canceledAt: null,
      result: null,
      error: null,
    };
    await this.store.write("PENDING", record);
    this.logger.info("[delayed-tasks] enqueued", {
      id,
      name: record.name,
      scheduledAt: record.scheduledAt,
      weight,
    });
    return record;
  }

  async get(id: number) {
    return (
      (await this.store.read("PENDING", id)) ??
      (await this.store.read("FINISH", id)) ??
      (await this.store.read("CANCELED", id))
    );
  }

  async cancel(id: number) {
    const pending = await this.store.read("PENDING", id);
    if (!pending) return null;
    if (pending.status !== "pending") return null;
    const canceled: TaskRecord = {
      ...pending,
      status: "canceled",
      canceledAt: new Date().toISOString(),
    };
    await this.store.move("PENDING", "CANCELED", canceled);
    this.logger.info("[delayed-tasks] cancelled", { id });
    return canceled;
  }

  async replay(id: number, options: ReplayOptions = {}) {
    const canceled = await this.store.read("CANCELED", id);
    if (!canceled) return null;
    const scheduledAtMs =
      options.scheduledAt !== undefined
        ? resolveScheduledAt(options.scheduledAt)
        : canceled.scheduledAtMs;
    const replayed: TaskRecord = {
      ...canceled,
      status: "pending",
      scheduledAt: new Date(scheduledAtMs).toISOString(),
      scheduledAtMs,
      canceledAt: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
      attempts: 0,
    };
    await this.store.move("CANCELED", "PENDING", replayed);
    this.logger.info("[delayed-tasks] replayed", { id, scheduledAt: replayed.scheduledAt });
    return replayed;
  }

  start() {
    if (this.started) return;
    this.scheduler.start();
    this.started = true;
    this.logger.info("[delayed-tasks] scheduler started", {
      namespace: this.namespace,
      maxTasks: this.maxTasks,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  async stop() {
    if (!this.started) return;
    await this.scheduler.stop();
    this.started = false;
    this.logger.info("[delayed-tasks] scheduler stopped");
  }
}

function resolveScheduledAt(value: Date | number | undefined) {
  if (value === undefined) return Date.now();
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new Error("scheduledAt: invalid Date");
    return ms;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("scheduledAt: must be a Date or a finite timestamp (ms)");
  }
  return value;
}

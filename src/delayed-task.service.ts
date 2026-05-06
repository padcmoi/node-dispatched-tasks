import type { Redis } from "ioredis";
import { HandlerNotFoundError } from "./errors.js";
import { RedisStore } from "./redis-store.js";
import { resolveScheduledAt } from "./schedule.js";
import { Scheduler } from "./scheduler.js";
import { TaskRegistry } from "./task-registry.js";
import type { EnqueueInput, Logger, ReplayOptions, TaskDefinition, TaskRecord } from "./types.js";

export interface DelayedTaskServiceOptions {
  redis: Redis;
  namespace: string;
  maxWeight?: number;
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
  private readonly maxWeight: number;
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
    const maxWeight = options.maxWeight ?? 5;
    if (!Number.isFinite(maxWeight) || maxWeight <= 0) {
      throw new Error("DelayedTaskService: 'maxWeight' must be a positive number");
    }
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new Error("DelayedTaskService: 'pollIntervalMs' must be a positive number");
    }

    this.namespace = options.namespace.trim();
    this.maxWeight = maxWeight;
    this.pollIntervalMs = pollIntervalMs;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.store = new RedisStore(options.redis, this.namespace);
    this.scheduler = new Scheduler({
      store: this.store,
      registry: this.registry,
      maxWeight: this.maxWeight,
      pollIntervalMs: this.pollIntervalMs,
      logger: this.logger,
    });

    this.list = {
      pending: () => this.store.list("PENDING"),
      finished: () => this.store.list("FINISH"),
      failed: () => this.store.list("FAILED"),
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
    const requested = input.weight ?? definition.weight ?? 1;
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new Error("enqueue: 'weight' must be a positive number");
    }
    // Clamp at enqueue time so a task can never be created with a weight that exceeds maxWeight.
    const weight = Math.min(requested, this.maxWeight);
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
      (await this.store.read("FAILED", id)) ??
      (await this.store.read("CANCELED", id))
    );
  }

  async setWeight(id: number, weight: number) {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error("setWeight: 'weight' must be a positive number");
    }
    const pending = await this.store.read("PENDING", id);
    if (!pending) return null;
    if (pending.status !== "pending") return null;
    const clamped = Math.min(weight, this.maxWeight);
    const updated: TaskRecord = { ...pending, weight: clamped };
    await this.store.write("PENDING", updated);
    this.logger.info("[delayed-tasks] weight updated", { id, weight: clamped, requested: weight });
    return updated;
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
    const from: "CANCELED" | "FAILED" | null = canceled ? "CANCELED" : (await this.store.read("FAILED", id)) ? "FAILED" : null;
    if (!from) return null;
    const source = from === "CANCELED" ? canceled : await this.store.read("FAILED", id);
    if (!source) return null;
    const scheduledAtMs = options.scheduledAt !== undefined ? resolveScheduledAt(options.scheduledAt) : source.scheduledAtMs;
    const replayed: TaskRecord = {
      ...source,
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
    await this.store.move(from, "PENDING", replayed);
    this.logger.info("[delayed-tasks] replayed", { id, from, scheduledAt: replayed.scheduledAt });
    return replayed;
  }

  start() {
    if (this.started) return;
    this.scheduler.start();
    this.started = true;
    this.logger.info("[delayed-tasks] scheduler started", {
      namespace: this.namespace,
      maxWeight: this.maxWeight,
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

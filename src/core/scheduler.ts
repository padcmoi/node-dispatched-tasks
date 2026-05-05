import { computeBackoffMs } from "./retry-policy.js";
import { TaskTimeoutError } from "./errors.js";
import { validatePayload } from "../validation/zod-validate.js";
import type { PriorityIndex } from "../priority/priority-index.interface.js";
import type { TaskStore } from "../store/task-store.interface.js";
import type { TaskRegistry } from "./task-registry.js";
import type { Logger, RunContext, TaskDefinition, TaskRecord } from "./types.js";

export interface SchedulerOptions {
  store: TaskStore;
  priority: PriorityIndex;
  registry: TaskRegistry;
  workerId: string;
  pollIntervalMs?: number;
  promoteIntervalMs?: number;
  maxConcurrentTasks?: number;
  maxConcurrentWeight?: number;
  logger?: Logger;
}

interface InFlightTask {
  publicId: string;
  weight: number;
  promise: Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_PROMOTE_INTERVAL_MS = 1_000;
const DEFAULT_MAX_CONCURRENT_TASKS = 10;
const DEFAULT_MAX_CONCURRENT_WEIGHT = 100;

export class Scheduler {
  private readonly store: TaskStore;
  private readonly priority: PriorityIndex;
  private readonly registry: TaskRegistry;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly promoteIntervalMs: number;
  private readonly maxConcurrentTasks: number;
  private readonly maxConcurrentWeight: number;
  private readonly logger: Logger;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPromoteAt = 0;
  private currentWeightInUse = 0;
  private readonly inFlight = new Map<string, InFlightTask>();

  constructor(options: SchedulerOptions) {
    this.store = options.store;
    this.priority = options.priority;
    this.registry = options.registry;
    this.workerId = options.workerId;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.promoteIntervalMs = options.promoteIntervalMs ?? DEFAULT_PROMOTE_INTERVAL_MS;
    this.maxConcurrentTasks = options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS;
    this.maxConcurrentWeight = options.maxConcurrentWeight ?? DEFAULT_MAX_CONCURRENT_WEIGHT;
    this.logger = options.logger ?? createSilentLogger();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scheduleTick(0);
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = Array.from(this.inFlight.values()).map((t) => t.promise);
    await Promise.allSettled(pending);
  }

  isRunning() {
    return this.running;
  }

  private scheduleTick(delayMs: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick() {
    if (!this.running) return;
    try {
      const now = Date.now();
      if (now - this.lastPromoteAt >= this.promoteIntervalMs) {
        await this.priority.promoteDueDelayed(now);
        this.lastPromoteAt = now;
      }
      await this.drainCapacity();
    } catch (err) {
      this.logger.error("[dispatched-tasks] scheduler tick error", { error: errorToString(err) });
    } finally {
      this.scheduleTick(this.pollIntervalMs);
    }
  }

  private async drainCapacity() {
    while (this.running && this.canTakeMoreTasks()) {
      const claim = await this.priority.popReady();
      if (!claim) return;
      const record = await this.store.getByPublicId(claim.publicId);
      if (!record) {
        this.logger.warn("[dispatched-tasks] orphan id in queue, dropping", { publicId: claim.publicId });
        continue;
      }
      if (record.status !== "pending" && record.status !== "failed") {
        continue;
      }
      if (!this.fitsWeight(record.weight)) {
        await this.priority.enqueueReady(record.publicId, claim.score);
        return;
      }
      const handler = this.registry.tryGet(record.code);
      if (!handler) {
        await this.store.markFailed(record.publicId, `No handler registered for code '${record.code}'`, false);
        this.logger.error("[dispatched-tasks] no handler for code, marking dead", {
          publicId: record.publicId,
          code: record.code,
        });
        continue;
      }
      const claimed = await this.store.claim(record.publicId, this.workerId);
      if (!claimed) continue;
      this.beginInFlight(claimed, handler);
    }
  }

  private canTakeMoreTasks() {
    return this.inFlight.size < this.maxConcurrentTasks && this.currentWeightInUse < this.maxConcurrentWeight;
  }

  private fitsWeight(weight: number) {
    return this.currentWeightInUse + weight <= this.maxConcurrentWeight;
  }

  private beginInFlight(record: TaskRecord, handler: TaskDefinition) {
    this.currentWeightInUse += record.weight;
    const promise = this.executeTask(record, handler).finally(() => {
      this.inFlight.delete(record.publicId);
      this.currentWeightInUse = Math.max(0, this.currentWeightInUse - record.weight);
    });
    this.inFlight.set(record.publicId, { publicId: record.publicId, weight: record.weight, promise });
  }

  private async executeTask(record: TaskRecord, handler: TaskDefinition) {
    const ttlSeconds = Math.ceil(handler.timeoutMs / 1000) + 60;
    await this.priority.trackRunning(record.publicId, ttlSeconds);
    await this.store.markStarted(record.publicId);

    const abort = new AbortController();
    const timeoutHandle = setTimeout(() => abort.abort(), handler.timeoutMs);
    const ctx: RunContext = {
      publicId: record.publicId,
      attempt: record.attempts,
      scheduledAt: record.scheduledAt,
      triggeredAt: new Date(),
      signal: abort.signal,
    };

    try {
      const validated = validatePayload(handler.inputSchema, record.payload);
      const result = await runWithTimeout(handler, validated, ctx, abort);
      clearTimeout(timeoutHandle);
      await this.store.markSucceeded(record.publicId, result);
      this.logger.info("[dispatched-tasks] task succeeded", {
        publicId: record.publicId,
        code: record.code,
        attempt: record.attempts,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      const message = errorToString(err);
      const willRetry = record.attempts < record.maxAttempts;
      await this.store.markFailed(record.publicId, message, willRetry);
      if (willRetry) {
        const delayMs = computeBackoffMs(handler.backoff, record.attempts);
        const scheduledAt = new Date(Date.now() + delayMs);
        await this.store.resetForRetry(record.publicId, scheduledAt);
        await this.priority.enqueueDelayed(record.publicId, scheduledAt.getTime());
        this.logger.warn("[dispatched-tasks] task failed, scheduled retry", {
          publicId: record.publicId,
          code: record.code,
          attempt: record.attempts,
          retryInMs: delayMs,
        });
      } else {
        this.logger.error("[dispatched-tasks] task failed, no more retries (dead)", {
          publicId: record.publicId,
          code: record.code,
          attempts: record.attempts,
        });
      }
    } finally {
      await this.priority.untrackRunning(record.publicId);
    }
  }
}

async function runWithTimeout(handler: TaskDefinition, payload: unknown, ctx: RunContext, abort: AbortController) {
  const work = Promise.resolve().then(() => handler.run(payload, ctx));
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort.signal.addEventListener("abort", () => reject(new TaskTimeoutError(ctx.publicId, handler.timeoutMs)), { once: true });
  });
  return Promise.race([work, cancellation]);
}

function createSilentLogger() {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
}

function errorToString(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

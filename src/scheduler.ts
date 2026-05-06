import type { RedisStore } from "./redis-store.js";
import type { TaskRegistry } from "./task-registry.js";
import type { Logger, RunContext, TaskRecord } from "./types.js";

export interface SchedulerOptions {
  store: RedisStore;
  registry: TaskRegistry;
  maxWeight: number;
  pollIntervalMs: number;
  logger: Logger;
}

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly inflight = new Map<number, AbortController>();
  private currentWeight = 0;
  private stopped = true;

  constructor(private readonly opts: SchedulerOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const ac of this.inflight.values()) ac.abort();
    while (this.inflight.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private scheduleNext() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.opts.pollIntervalMs);
  }

  private async tick() {
    if (this.stopped) return;
    try {
      const pending = await this.opts.store.list("PENDING");
      const now = Date.now();
      for (const task of pending) {
        if (this.stopped) break;
        if (task.status === "running") continue;
        if (this.inflight.has(task.id)) continue;
        if (task.scheduledAtMs > now) continue;
        if (this.currentWeight + task.weight > this.opts.maxWeight) continue;
        this.run(task);
      }
    } catch (err) {
      this.opts.logger.error("[delayed-tasks] scheduler tick error", { error: errorToString(err) });
    } finally {
      this.scheduleNext();
    }
  }

  private run(task: TaskRecord) {
    const ac = new AbortController();
    this.inflight.set(task.id, ac);
    this.currentWeight += task.weight;

    const release = () => {
      this.currentWeight -= task.weight;
      this.inflight.delete(task.id);
    };

    if (!this.opts.registry.has(task.name)) {
      const final: TaskRecord = {
        ...task,
        status: "failed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: `No handler registered for task name "${task.name}"`,
      };
      void this.opts.store
        .move("PENDING", "FAILED", final)
        .catch((err: unknown) =>
          this.opts.logger.error("[delayed-tasks] move failed", { id: task.id, error: errorToString(err) })
        )
        .finally(release);
      return;
    }

    const definition = this.opts.registry.get(task.name);
    const startedAt = new Date().toISOString();
    const running: TaskRecord = { ...task, status: "running", startedAt, attempts: task.attempts + 1 };
    void this.opts.store.write("PENDING", running).catch(() => undefined);

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (definition.timeoutMs && definition.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, definition.timeoutMs);
    }

    const ctx: RunContext = { id: task.id, name: task.name, signal: ac.signal };

    Promise.resolve()
      .then(() => definition.run(task.data, ctx))
      .then(async (result) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const final: TaskRecord = {
          ...running,
          status: "finished",
          finishedAt: new Date().toISOString(),
          result: result ?? null,
        };
        await this.opts.store.move("PENDING", "FINISH", final);
        this.opts.logger.info("[delayed-tasks] task finished", { id: task.id, name: task.name });
      })
      .catch(async (err: unknown) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const final: TaskRecord = {
          ...running,
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: timedOut ? `Task timed out after ${String(definition.timeoutMs)}ms` : errorToString(err),
        };
        try {
          await this.opts.store.move("PENDING", "FAILED", final);
        } catch (moveErr) {
          this.opts.logger.error("[delayed-tasks] move failed", { id: task.id, error: errorToString(moveErr) });
        }
        this.opts.logger.error("[delayed-tasks] task failed", { id: task.id, name: task.name, error: final.error });
      })
      .finally(release);
  }
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

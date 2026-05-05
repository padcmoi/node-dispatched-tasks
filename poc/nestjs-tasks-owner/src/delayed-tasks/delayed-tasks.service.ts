import { Redis } from "ioredis";
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import {
  DelayedTaskService as LibService,
  type EnqueueInput,
  type ReplayOptions,
  type TaskDefinition,
} from "@naskot/node-dispatched-tasks";
import helloWorld from "../jobs/delayed-task/hello-world.task.js";
import heavy from "../jobs/delayed-task/heavy.task.js";

export const DT_REDIS = "DT_REDIS";

@Injectable()
export class DelayedTaskService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly lib: LibService;

  constructor(@Inject(DT_REDIS) private readonly redis: Redis) {
    this.lib = new LibService({
      redis,
      namespace: process.env.DT_NAMESPACE ?? "delayed-tasks",
      maxTasks: Number(process.env.DT_MAX_TASKS ?? 5),
      pollIntervalMs: Number(process.env.DT_POLL_INTERVAL_MS ?? 1000),
      logger: console,
    });
  }

  onApplicationBootstrap() {
    this.register(helloWorld);
    this.register(heavy);

    const isMaster =
      process.env.NODE_APP_INSTANCE === undefined ||
      process.env.NODE_APP_INSTANCE === "0";
    const wantsScheduler = process.env.OWNER_RUN_SCHEDULER !== "false";
    if (isMaster && wantsScheduler) {
      this.lib.start();
    }
  }

  async onApplicationShutdown() {
    await this.lib.stop();
    if (this.redis.status !== "end") {
      await this.redis.quit().catch(() => undefined);
    }
  }

  register(definition: TaskDefinition) {
    this.lib.register(definition);
  }
  has(name: string) {
    return this.lib.has(name);
  }
  enqueue(input: EnqueueInput) {
    return this.lib.enqueue(input);
  }
  cancel(id: number) {
    return this.lib.cancel(id);
  }
  replay(id: number, options?: ReplayOptions) {
    return this.lib.replay(id, options);
  }
  get(id: number) {
    return this.lib.get(id);
  }
  list = {
    pending: () => this.lib.list.pending(),
    finished: () => this.lib.list.finished(),
    canceled: () => this.lib.list.canceled(),
  };
}

export const dtRedisProvider = {
  provide: DT_REDIS,
  useFactory: () =>
    new Redis({
      host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.DT_REDIS_PORT ?? 6379),
      password: process.env.DT_REDIS_PASSWORD ?? undefined,
      maxRetriesPerRequest: null,
    }),
};

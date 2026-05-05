import IORedis, { type Redis } from "ioredis";
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  DispatchedTask,
  DispatchedTaskService as LibService,
  RedisPriorityIndex,
  TypeOrmTaskStore,
  type EnqueueInput,
  type TaskListFilters,
} from "@naskot/node-dispatched-tasks";

import echoFromExpress from "../jobs/dispatched-tasks/echo-from-express.task";
import echoFromNestjs from "../jobs/dispatched-tasks/echo-from-nestjs.task";

export const DT_DATA_SOURCE = "DT_DATA_SOURCE";
export const DT_REDIS = "DT_REDIS";

export const dataSourceProvider = {
  provide: DT_DATA_SOURCE,
  useFactory: async () => {
    const ds = new DataSource({
      type: "mariadb",
      host: process.env.DT_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DT_DB_PORT ?? 3306),
      database: process.env.DT_DB_NAME ?? "dispatched_tasks_poc",
      username: process.env.DT_DB_USER ?? "app",
      password: process.env.DT_DB_PASSWORD ?? "app",
      entities: [DispatchedTask],
      synchronize: true,
      logging: false,
    });
    await ds.initialize();
    return ds;
  },
};

export const redisProvider = {
  provide: DT_REDIS,
  useFactory: () =>
    new IORedis({
      host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.DT_REDIS_PORT ?? 6379),
      maxRetriesPerRequest: null,
    }),
};

@Injectable()
export class DispatchedTaskService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("DispatchedTaskService");
  private readonly lib: LibService;

  constructor(
    @Inject(DT_DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(DT_REDIS) private readonly redis: Redis
  ) {
    const repository = dataSource.getRepository(DispatchedTask);
    this.lib = new LibService({
      store: new TypeOrmTaskStore({ repository }),
      priority: new RedisPriorityIndex({
        redis,
        namespace: process.env.DT_REDIS_NAMESPACE ?? "dispatched-tasks",
      }),
      workerId: process.env.WORKER_ID ?? `tasks-owner-${process.pid}`,
      scheduler: {
        enabled: true,
        pollIntervalMs: 500,
        promoteIntervalMs: 1000,
        maxConcurrentTasks: 10,
        maxConcurrentWeight: 100,
      },
      logger: {
        info: (msg, meta) => this.log.log(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
        warn: (msg, meta) => this.log.warn(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
        error: (msg, meta) => this.log.error(meta ? `${msg} ${JSON.stringify(meta)}` : msg),
      },
    });
    this.lib.register(echoFromExpress);
    this.lib.register(echoFromNestjs);
  }

  async onApplicationBootstrap() {
    await this.lib.start();
    this.log.log(`registered task codes: ${this.lib.listRegisteredCodes().join(", ")}`);
  }

  async onApplicationShutdown() {
    await this.lib.stop();
    await this.redis.quit();
    await this.dataSource.destroy();
  }

  enqueue(input: EnqueueInput) {
    return this.lib.enqueue(input);
  }

  get(publicId: string) {
    return this.lib.get(publicId);
  }

  list(filters: TaskListFilters = {}) {
    return this.lib.list(filters);
  }

  retry(publicId: string) {
    return this.lib.retry(publicId);
  }

  cancel(publicId: string) {
    return this.lib.cancel(publicId);
  }
}

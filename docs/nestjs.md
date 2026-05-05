[← Back to README](../README.md) · [Express guide →](./express.md)

# NestJS integration

This guide shows how to wire `@naskot/node-dispatched-tasks` into a NestJS app.

> Configuration rule: do **not** read `process.env` inside the library code.
> Read env values in the provider/service layer below, then pass plain config to the library.

---

## 1) Provider / service file

`src/dispatched-tasks/dispatched-task.service.ts`

```ts
import "reflect-metadata";
import IORedis, { type Redis } from "ioredis";
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import {
  DispatchedTask,
  DispatchedTaskService as LibDispatchedTaskService,
  RedisPriorityIndex,
  TypeOrmTaskStore,
  type EnqueueInput,
  type TaskListFilters,
} from "@naskot/node-dispatched-tasks";

export const DT_DATA_SOURCE = "DT_DATA_SOURCE";
export const DT_REDIS = "DT_REDIS";

@Injectable()
export class DispatchedTaskService implements OnModuleInit, OnModuleDestroy {
  private readonly lib: LibDispatchedTaskService;

  constructor(
    @Inject(DT_DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(DT_REDIS) private readonly redis: Redis
  ) {
    const repository: Repository<DispatchedTask> = dataSource.getRepository(DispatchedTask);
    this.lib = new LibDispatchedTaskService({
      store: new TypeOrmTaskStore({ repository }),
      priority: new RedisPriorityIndex({
        redis,
        namespace: process.env.DT_REDIS_NAMESPACE ?? "dispatched-tasks",
      }),
      workerId: process.env.WORKER_ID ?? `${process.env.HOSTNAME ?? "worker"}-${String(process.pid)}`,
      scheduler: {
        enabled: true,
        pollIntervalMs: 1000,
        promoteIntervalMs: 1000,
        maxConcurrentTasks: 10,
        maxConcurrentWeight: 100,
      },
      logger: console,
    });
  }

  async onModuleInit() {
    await this.lib.start();
  }

  async onModuleDestroy() {
    await this.lib.stop();
  }

  // Re-exposes the library API so the rest of the app uses Nest's DI system.
  register: typeof this.lib.register = (def) => this.lib.register(def);
  enqueue = (input: EnqueueInput) => this.lib.enqueue(input);
  get = (publicId: string) => this.lib.get(publicId);
  list = (filters?: TaskListFilters) => this.lib.list(filters);
  retry = (publicId: string) => this.lib.retry(publicId);
  cancel = (publicId: string) => this.lib.cancel(publicId);
}
```

---

## 2) Module

`src/dispatched-tasks/dispatched-tasks.module.ts`

```ts
import IORedis from "ioredis";
import { Module, type OnModuleDestroy } from "@nestjs/common";
import { DataSource } from "typeorm";
import { DispatchedTask } from "@naskot/node-dispatched-tasks";
import { DispatchedTaskController } from "./dispatched-tasks.controller.js";
import { DispatchedTaskService, DT_DATA_SOURCE, DT_REDIS } from "./dispatched-task.service.js";

@Module({
  controllers: [DispatchedTaskController],
  providers: [
    {
      provide: DT_DATA_SOURCE,
      useFactory: async () => {
        const ds = new DataSource({
          type: "mariadb",
          host: process.env.DT_DB_HOST ?? "127.0.0.1",
          port: Number(process.env.DT_DB_PORT ?? 3306),
          database: process.env.DT_DB_NAME ?? "app",
          username: process.env.DT_DB_USER ?? "root",
          password: process.env.DT_DB_PASSWORD ?? "",
          entities: [DispatchedTask],
          synchronize: true, // dev-only
          logging: false,
        });
        await ds.initialize();
        return ds;
      },
    },
    {
      provide: DT_REDIS,
      useFactory: () =>
        new IORedis({
          host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
          port: Number(process.env.DT_REDIS_PORT ?? 6379),
          maxRetriesPerRequest: null,
        }),
    },
    DispatchedTaskService,
  ],
  exports: [DispatchedTaskService],
})
export class DispatchedTasksModule implements OnModuleDestroy {
  async onModuleDestroy() {
    // No-op here: each provider handles its own teardown.
    // (DataSource.destroy and Redis.quit can be called from a dedicated lifecycle if you prefer.)
  }
}
```

---

## 3) Controller (admin endpoints + receive-task endpoint)

`src/dispatched-tasks/dispatched-tasks.controller.ts`

```ts
import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { DispatchedTaskService } from "./dispatched-task.service.js";

@Controller("tasks")
export class DispatchedTaskController {
  constructor(private readonly tasks: DispatchedTaskService) {}

  @Post()
  @HttpCode(202)
  async enqueue(
    @Body()
    body: {
      code: string;
      payload?: unknown;
      idempotencyKey?: string;
      scheduledAt?: string | null;
      weight?: number;
      priority?: number;
      correlationId?: string;
    }
  ) {
    const record = await this.tasks.enqueue({
      code: body.code,
      payload: body.payload,
      idempotencyKey: body.idempotencyKey ?? null,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      weight: body.weight,
      priority: body.priority ?? null,
      correlationId: body.correlationId ?? null,
      source: "http",
    });
    return { publicId: record.publicId, status: record.status };
  }

  @Get(":publicId")
  async get(@Param("publicId") publicId: string) {
    const r = await this.tasks.get(publicId);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get()
  async list(@Query("code") code: string | undefined, @Query("limit") limit: string | undefined) {
    return this.tasks.list({ code, limit: limit ? Number(limit) : 50 });
  }

  @Post(":publicId/retry")
  async retry(@Param("publicId") publicId: string) {
    const r = await this.tasks.retry(publicId);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Post(":publicId/cancel")
  async cancel(@Param("publicId") publicId: string) {
    const r = await this.tasks.cancel(publicId);
    if (!r) throw new NotFoundException();
    return r;
  }
}
```

---

## 4) A handler file (`*.task.ts`)

Same shape as your project's cron jobs. Single `defineTask({...})` exported as default.

`src/jobs/dispatched-tasks/hello-world.task.ts`

```ts
import { defineTask } from "@naskot/node-dispatched-tasks";
import { z } from "zod";

const task = defineTask({
  code: "HELLO_WORLD",
  weight: 1,
  maxAttempts: 3,
  timeoutMs: 30_000,
  inputSchema: z.object({ name: z.string() }),
  run: async (payload, ctx) => {
    console.info(`[task ${ctx.publicId}] hello, ${payload.name}!`);
    return { greeted: payload.name };
  },
});

export default task;
```

Register at boot (e.g. via an `OnApplicationBootstrap` hook):

```ts
import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DispatchedTaskService } from "./dispatched-tasks/dispatched-task.service.js";
import helloWorld from "./jobs/dispatched-tasks/hello-world.task.js";

@Injectable()
export class TaskRegistration implements OnApplicationBootstrap {
  constructor(private readonly tasks: DispatchedTaskService) {}
  onApplicationBootstrap() {
    this.tasks.register(helloWorld);
  }
}
```

---

## 5) `main.ts`

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

---

## 6) Production notes

- **Required envs (resolved in the provider layer)**: `DT_REDIS_HOST`, `DT_REDIS_PORT`, `DT_REDIS_NAMESPACE`, `DT_DB_HOST`, `DT_DB_PORT`, `DT_DB_NAME`, `DT_DB_USER`, `DT_DB_PASSWORD`, optionally `WORKER_ID`.
- **`reflect-metadata`**: import once at the top of `main.ts` for both NestJS and TypeORM decorators.
- **Migrations**: replace `synchronize: true` with TypeORM migrations in production.
- **Multi-process**: in PM2 cluster mode, every worker can run the scheduler. The Redis ZSET claim is atomic.
- **Validation**: prefer Zod `inputSchema` on every task — fails fast at enqueue time.
- **Tests**: the lib ships interface contracts. For unit tests, use the in-memory adapters under `test/fixtures/` of this repo as a reference.

---

[← Back to README](../README.md) · [Express guide →](./express.md)

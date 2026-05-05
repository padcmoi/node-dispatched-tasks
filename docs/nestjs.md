[← Back to README](../README.md) · [Express guide](./express.md)

# NestJS integration

This guide shows how to wire `@naskot/node-dispatched-tasks` v2 (pure-Redis) into a NestJS app.

> Configuration rule: do **not** read `process.env` inside the library code.
> Read env values in the provider/service layer below, then pass plain config to the library.

> Single-master rule: the scheduler must run on **only one process** (typically PM2 instance `0`). Your bootstrap initializer is responsible for that gate.

---

## 1) Provider / service file

`src/delayed-tasks/delayed-tasks.service.ts`

```ts
import IORedis, { type Redis } from "ioredis";
import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import {
  DelayedTaskService as LibService,
  type EnqueueInput,
  type ReplayOptions,
} from "@naskot/node-dispatched-tasks";

export const DT_REDIS = "DT_REDIS";

@Injectable()
export class DelayedTaskService implements OnApplicationShutdown {
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

  async onApplicationShutdown() {
    await this.lib.stop();
  }

  // Re-expose the library API.
  register: typeof this.lib.register = (def) => this.lib.register(def);
  has = (name: string) => this.lib.has(name);
  enqueue = (input: EnqueueInput) => this.lib.enqueue(input);
  cancel = (id: number) => this.lib.cancel(id);
  replay = (id: number, options?: ReplayOptions) => this.lib.replay(id, options);
  get = (id: number) => this.lib.get(id);
  list = this.lib.list;
  start = () => this.lib.start();
  stop = () => this.lib.stop();
}
```

---

## 2) Module

`src/delayed-tasks/delayed-tasks.module.ts`

```ts
import IORedis from "ioredis";
import { Module } from "@nestjs/common";
import { DelayedTaskController } from "./delayed-tasks.controller.js";
import { DelayedTaskService, DT_REDIS } from "./delayed-tasks.service.js";

@Module({
  controllers: [DelayedTaskController],
  providers: [
    {
      provide: DT_REDIS,
      useFactory: () =>
        new IORedis({
          host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
          port: Number(process.env.DT_REDIS_PORT ?? 6379),
          password: process.env.DT_REDIS_PASSWORD ?? undefined,
          maxRetriesPerRequest: null,
        }),
    },
    DelayedTaskService,
  ],
  exports: [DelayedTaskService],
})
export class DelayedTasksModule {}
```

---

## 3) Controller (admin endpoints + receive-task endpoint)

`src/delayed-tasks/delayed-tasks.controller.ts`

```ts
import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { DelayedTaskService } from "./delayed-tasks.service.js";

@Controller("tasks")
export class DelayedTaskController {
  constructor(private readonly tasks: DelayedTaskService) {}

  @Post()
  @HttpCode(202)
  async enqueue(
    @Query("name") name: string,
    @Body()
    body: {
      data?: unknown;
      scheduledAt?: string;
      weight?: number;
    }
  ) {
    if (!this.tasks.has(name)) throw new NotFoundException(`unknown task '${name}'`);
    return this.tasks.enqueue({
      name,
      data: body?.data,
      scheduledAt: body?.scheduledAt ? new Date(body.scheduledAt) : undefined,
      weight: body?.weight,
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const r = await this.tasks.get(Number(id));
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get()
  async list() {
    const [pending, finished, canceled] = await Promise.all([
      this.tasks.list.pending(),
      this.tasks.list.finished(),
      this.tasks.list.canceled(),
    ]);
    return { pending, finished, canceled };
  }

  @Post(":id/cancel")
  async cancel(@Param("id") id: string) {
    const r = await this.tasks.cancel(Number(id));
    if (!r) throw new NotFoundException();
    return r;
  }

  @Post(":id/replay")
  async replay(
    @Param("id") id: string,
    @Body() body: { scheduledAt?: string }
  ) {
    const r = await this.tasks.replay(Number(id), {
      scheduledAt: body?.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
    if (!r) throw new NotFoundException();
    return r;
  }
}
```

---

## 4) A handler file (`*.task.ts`)

`src/jobs/delayed-task/hello-world.task.ts`

```ts
import { defineTask } from "@naskot/node-dispatched-tasks";

export default defineTask({
  name: "HELLO_WORLD",
  weight: 1,
  timeoutMs: 30_000,
  run: (data, ctx) => {
    console.info(`[task ${ctx.id}] HELLO_WORLD`, data);
    return { ok: true };
  },
});
```

Register at boot — only the master process should also `start()` the scheduler:

```ts
import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DelayedTaskService } from "./delayed-tasks/delayed-tasks.service.js";
import helloWorld from "./jobs/delayed-task/hello-world.task.js";

@Injectable()
export class TaskRegistration implements OnApplicationBootstrap {
  constructor(private readonly tasks: DelayedTaskService) {}

  onApplicationBootstrap() {
    this.tasks.register(helloWorld);
    const isMaster =
      process.env.NODE_APP_INSTANCE === undefined ||
      process.env.NODE_APP_INSTANCE === "0";
    if (isMaster) this.tasks.start();
  }
}
```

> If you use a runtime-bootstrap framework (e.g. `@naskot/node-runtime-bootstrap`), put `tasks.start()` inside the `once()` hook of an initializer file — that hook is invoked only on the master process.

---

## 5) `main.ts`

```ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

---

## 6) Production notes

- **Required envs (resolved in the provider layer)**: `DT_REDIS_HOST`, `DT_REDIS_PORT`, optional `DT_REDIS_PASSWORD`, `DT_NAMESPACE`, `DT_MAX_TASKS`, `DT_POLL_INTERVAL_MS`.
- **Single scheduler**: only call `start()` on the master process. Other PM2 workers can still `enqueue`/`cancel`/`replay`/`list` against the same namespace — they just skip `start()`.
- **Validation**: validate `data` at the controller boundary (e.g. with `class-validator` or a hand-rolled check) before calling `enqueue` — the lib does not validate `data`.
- **Crash recovery**: a process crash mid-execution leaves a task in `<NS>:PENDING:task-<id>` with `status = "running"`. The scheduler does not re-pick it on restart; expose an admin route to surface running tasks and `replay` them manually.

---

[← Back to README](../README.md) · [Express guide](./express.md)

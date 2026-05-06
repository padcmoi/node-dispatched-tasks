[← Back to README](../README.md) · [Express guide](./express.md)

# NestJS integration

Wire `@naskot/node-dispatched-tasks` into a NestJS app.

> Configuration rule: do **not** read `process.env` inside the library code.
> Read env values in the provider/service layer below, then pass plain config to the library.

> Single-master rule: the scheduler must run on **only one process** (typically PM2 instance `0`). Your bootstrap initializer is responsible for that gate.

---

## 1) Service

A NestJS-friendly wrapper around the lib. Owns the lifecycle and re-exposes the API for DI consumers.

`src/delayed-tasks/delayed-tasks.service.ts`

```ts
import { Redis } from "ioredis";
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import {
  DelayedTaskService as LibService,
  type EnqueueInput,
  type ReplayOptions,
  type TaskDefinition,
} from "@naskot/node-dispatched-tasks";

export const DT_REDIS = "DT_REDIS";

@Injectable()
export class DelayedTaskService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly lib: LibService;

  constructor(@Inject(DT_REDIS) private readonly redis: Redis) {
    this.lib = new LibService({
      redis,
      namespace: process.env.DT_NAMESPACE ?? "delayed-tasks",
      maxWeight: Number(process.env.DT_MAX_WEIGHT ?? 5),
      pollIntervalMs: Number(process.env.DT_POLL_INTERVAL_MS ?? 1000),
      logger: console,
    });
  }

  onApplicationBootstrap() {
    const isMaster = process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === "0";
    if (isMaster) this.lib.start();
  }

  async onApplicationShutdown() {
    await this.lib.stop();
    if (this.redis.status !== "end") await this.redis.quit().catch(() => undefined);
  }

  // Re-expose the lib API for DI consumers
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
  setWeight(id: number, weight: number) {
    return this.lib.setWeight(id, weight);
  }
  get(id: number) {
    return this.lib.get(id);
  }
  list = {
    pending: () => this.lib.list.pending(),
    finished: () => this.lib.list.finished(),
    failed: () => this.lib.list.failed(),
    canceled: () => this.lib.list.canceled(),
  };
}
```

---

## 2) Module

`src/delayed-tasks/delayed-tasks.module.ts`

```ts
import { Redis } from "ioredis";
import { Module } from "@nestjs/common";
import { DelayedTaskService, DT_REDIS } from "./delayed-tasks.service.js";

@Module({
  providers: [
    {
      provide: DT_REDIS,
      useFactory: () =>
        new Redis({
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

Add `app.enableShutdownHooks()` in `main.ts` so `OnApplicationShutdown` fires.

---

## 3) Tasks

One file per task. Each exports a single `defineTask({...})`.

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

Register tasks at boot — typically in a small `OnApplicationBootstrap` provider (every process registers; only the master executes since only it called `start()`):

```ts
import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DelayedTaskService } from "./delayed-tasks/delayed-tasks.service.js";
import helloWorld from "./jobs/delayed-task/hello-world.task.js";

@Injectable()
export class TaskRegistration implements OnApplicationBootstrap {
  constructor(private readonly tasks: DelayedTaskService) {}
  onApplicationBootstrap() {
    this.tasks.register(helloWorld);
  }
}
```

---

## 4) Helpers / functions

Inject `DelayedTaskService` wherever you need it (controller, provider, scheduler, microservice handler). All operations are methods on the instance.

### `register(definition)`

Add a task definition to the in-process registry. `enqueue` rejects unknown names.

```ts
this.tasks.register(helloWorld);
```

### `has(name)`

Check if a name is registered.

```ts
if (!this.tasks.has(name)) throw new NotFoundException();
```

### `enqueue(input)`

Create a new task in the `PENDING` bucket. Returns the persisted record.

```ts
// Run now
await this.tasks.enqueue({ name: "HELLO_WORLD", data: { user: 42 } });

// Run 30 seconds from now
await this.tasks.enqueue({ name: "HELLO_WORLD", scheduledAt: 30 });

// Run at an absolute date
await this.tasks.enqueue({ name: "HELLO_WORLD", scheduledAt: new Date("2026-12-31T23:59:00Z") });

// Same, accepted as a string
await this.tasks.enqueue({ name: "HELLO_WORLD", scheduledAt: "2026-12-31T23:59:00Z" });

// Override the definition's weight
await this.tasks.enqueue({ name: "HEAVY", weight: 4 });
```

`scheduledAt` accepts `Date`, `number` (seconds from now), or `string` (ISO date or numeric seconds-from-now). Omitted → run immediately.

### `cancel(id)`

Move a `PENDING` task to the `CANCELED` bucket. Returns `null` if the id is unknown or the task is already running/finished/canceled.

```ts
const record = await this.tasks.cancel(42);
```

### `setWeight(id, weight)`

Update the weight of a still-pending task. The new value is clamped to `maxWeight`. Returns `null` if the id is unknown or the task is no longer in `pending` status.

```ts
await this.tasks.setWeight(42, 4); // set weight to 4
await this.tasks.setWeight(42, 99); // clamped to maxWeight
```

> `enqueue` already clamps `weight` to the live `maxWeight`. `setWeight` is the dedicated way to fix tasks that became un-runnable after a `maxWeight` decrease (e.g. created with `weight: 8` while cap was `10`, then redeployed with cap `5` — those tasks stay blocked until you call `setWeight(id, ≤5)` or `cancel(id)`).

### `replay(id, options?)`

Move a task from `CANCELED` **or** `FAILED` back to `PENDING`. The lib finds the task in either bucket — you don't have to know where it is. Without options, the original `scheduledAt` is preserved. Provide a new `scheduledAt` to defer it. Returns `null` if the id is unknown or the task is currently `PENDING` / `FINISH`.

```ts
await this.tasks.replay(42); // keep original scheduledAt
await this.tasks.replay(42, { scheduledAt: 60 }); // 60s from now
await this.tasks.replay(42, { scheduledAt: "2027-01-01T00:00:00Z" });
```

### `get(id)`

Look up a task across all three buckets. Returns `null` if not found.

```ts
const record = await this.tasks.get(42);
```

### `list.pending()` / `list.finished()` / `list.failed()` / `list.canceled()`

Return all records in a bucket, sorted by id ascending. `finished` is for successful runs only — handler errors and timeouts go to `failed`.

```ts
const [pending, finished, failed, canceled] = await Promise.all([
  this.tasks.list.pending(),
  this.tasks.list.finished(),
  this.tasks.list.failed(),
  this.tasks.list.canceled(),
]);
```

### `start()` / `stop()`

Start/stop the polling scheduler. The wrapper above calls `start()` in `OnApplicationBootstrap` (master only) and `stop()` in `OnApplicationShutdown`. Don't call them manually unless you have a special lifecycle.

---

## 5) Production notes

- **Required envs (resolved in the provider layer)**: `DT_REDIS_HOST`, `DT_REDIS_PORT`, optional `DT_REDIS_PASSWORD`, `DT_NAMESPACE`, `DT_MAX_WEIGHT`, `DT_POLL_INTERVAL_MS`.
- **Single scheduler**: only the master process should call `start()`. Other PM2 workers can still `enqueue`/`cancel`/`replay`/`list` against the same namespace — they just skip `start()`.
- **Validation**: validate `data` at the controller boundary (e.g. with `class-validator` or a hand-rolled check) before calling `enqueue` — the lib does not validate `data`.
- **Crash recovery**: a process crash mid-execution leaves a task in `<NS>:PENDING:task-<id>` with `status = "running"`. The scheduler does not re-pick it on restart; expose an admin route to surface and `replay` it.

---

[← Back to README](../README.md) · [Express guide](./express.md)

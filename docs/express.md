[← Back to README](../README.md) · [NestJS guide →](./nestjs.md)

# Express integration

Wire `@naskot/node-dispatched-tasks` into an Express app.

> Configuration rule: do **not** read `process.env` inside the library code.
> Read env values in the service layer below, then pass plain config to the library.

> Single-master rule: the scheduler must run on **only one process** (typically PM2 instance `0`). Your bootstrap code is responsible for that gate.

---

## 1) Service

A thin module that owns the Redis connection + lib lifecycle and is imported wherever you need to call the API.

`src/services/delayed-tasks.service.ts`

```ts
import { Redis } from "ioredis";
import { DelayedTaskService } from "@naskot/node-dispatched-tasks";

export const redis = new Redis({
  host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.DT_REDIS_PORT ?? 6379),
  password: process.env.DT_REDIS_PASSWORD ?? undefined,
  maxRetriesPerRequest: null,
});

export const delayedTaskService = new DelayedTaskService({
  redis,
  namespace: process.env.DT_NAMESPACE ?? "delayed-tasks",
  maxWeight: Number(process.env.DT_MAX_WEIGHT ?? 5),
  pollIntervalMs: Number(process.env.DT_POLL_INTERVAL_MS ?? 1000),
  // Optional: auto-purge successful tasks older than N days (FINISH bucket only).
  // Leave undefined or set 0 to disable.
  finishedTtlDays: process.env.DT_FINISHED_TTL_DAYS ? Number(process.env.DT_FINISHED_TTL_DAYS) : undefined,
  logger: console,
});

export function startDelayedTasks() {
  const isMaster = process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === "0";
  if (isMaster) delayedTaskService.start();
}

export async function stopDelayedTasks() {
  await delayedTaskService.stop();
  await redis.quit();
}
```

---

## 2) Tasks

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

Register tasks at boot (only the master needs handlers since only it runs them, but registering on every process keeps `enqueue` validation working):

`src/index.ts`

```ts
import { delayedTaskService, startDelayedTasks, stopDelayedTasks } from "./services/delayed-tasks.service.js";
import helloWorld from "./jobs/delayed-task/hello-world.task.js";

delayedTaskService.register(helloWorld);
startDelayedTasks();

// ... your express app, then on shutdown:
process.on("SIGTERM", () => void stopDelayedTasks().then(() => process.exit(0)));
```

---

## 3) Helpers / functions

All operations are methods on the `delayedTaskService` instance. Use them from any route, middleware, or background script.

### `register(definition)`

Add a task definition to the in-process registry. `enqueue` rejects unknown names.

```ts
delayedTaskService.register(helloWorld);
```

### `has(name)`

Check if a name is registered (useful before calling `enqueue`).

```ts
if (!delayedTaskService.has(name)) return res.status(404).end();
```

### `enqueue(input)`

Create a new task in the `PENDING` bucket. Returns the persisted record.

```ts
// Run now
await delayedTaskService.enqueue({ name: "HELLO_WORLD", data: { user: 42 } });

// Run 30 seconds from now
await delayedTaskService.enqueue({ name: "HELLO_WORLD", scheduledAt: 30 });

// Run at an absolute date
await delayedTaskService.enqueue({ name: "HELLO_WORLD", scheduledAt: new Date("2026-12-31T23:59:00Z") });

// Same, accepted as a string
await delayedTaskService.enqueue({ name: "HELLO_WORLD", scheduledAt: "2026-12-31T23:59:00Z" });

// Override the definition's weight
await delayedTaskService.enqueue({ name: "HEAVY", weight: 4 });
```

`scheduledAt` accepts `Date`, `number` (seconds from now), or `string` (ISO date or numeric seconds-from-now). Omitted → run immediately.

#### Typed dispatch

`defineTask<P, R>` typing the `data` payload propagates to a second `enqueue` overload that accepts the definition directly:

```ts
const sendEmail = defineTask<{ to: string; subject: string }>({
  name: "SEND_EMAIL",
  run: (data) => {
    /* data is { to, subject } */
  },
});
delayedTaskService.register(sendEmail);

// `data` is constrained at compile time to { to, subject }
await delayedTaskService.enqueue(sendEmail, { data: { to: "u@x", subject: "Hi" }, scheduledAt: 30 });
```

### `cancel(id)`

Move a `PENDING` task to the `CANCELED` bucket. Returns `null` if the id is unknown or the task is already running/finished/canceled.

```ts
const record = await delayedTaskService.cancel(42);
```

### `setWeight(id, weight)`

Update the weight of a still-pending task. The new value is clamped to `maxWeight`. Returns `null` if the id is unknown or the task is no longer in `pending` status.

```ts
await delayedTaskService.setWeight(42, 4); // set weight to 4
await delayedTaskService.setWeight(42, 99); // clamped to maxWeight
```

> `enqueue` already clamps `weight` to the live `maxWeight`. `setWeight` is the dedicated way to fix tasks that became un-runnable after a `maxWeight` decrease (e.g. created with `weight: 8` while cap was `10`, then redeployed with cap `5` — those tasks stay blocked until you call `setWeight(id, ≤5)` or `cancel(id)`).

### `replay(id, options?)`

Move a task from `CANCELED` **or** `FAILED` back to `PENDING`. The lib finds the task in either bucket — you don't have to know where it is. Without options, the original `scheduledAt` is preserved. Provide a new `scheduledAt` to defer it. Returns `null` if the id is unknown or the task is currently `PENDING` / `FINISH`.

```ts
await delayedTaskService.replay(42); // keep original scheduledAt
await delayedTaskService.replay(42, { scheduledAt: 60 }); // 60s from now
await delayedTaskService.replay(42, { scheduledAt: "2027-01-01T00:00:00Z" });
```

### `get(id)`

Look up a task across all three buckets. Returns `null` if not found.

```ts
const record = await delayedTaskService.get(42);
```

### `list.pending()` / `list.finished()` / `list.failed()` / `list.canceled()`

Return all records in a bucket, sorted by id ascending. `finished` is for successful runs only — handler errors and timeouts go to `failed`.

```ts
const [pending, finished, failed, canceled] = await Promise.all([
  delayedTaskService.list.pending(),
  delayedTaskService.list.finished(),
  delayedTaskService.list.failed(),
  delayedTaskService.list.canceled(),
]);
```

### `start()` / `stop()`

Start/stop the polling scheduler. Call `start()` only on the master process. Always `stop()` on shutdown to flush in-flight tasks.

---

## 4) Production notes

- **Required envs (resolved in the service layer)**: `DT_REDIS_HOST`, `DT_REDIS_PORT`, optional `DT_REDIS_PASSWORD`, `DT_NAMESPACE`, `DT_MAX_WEIGHT`, `DT_POLL_INTERVAL_MS`, optional `DT_FINISHED_TTL_DAYS`.
- **FINISH retention**: set `DT_FINISHED_TTL_DAYS` to a positive integer to apply a Redis TTL on every successful task record (FINISH bucket only). Leave unset/`0` to keep records indefinitely.
- **Single scheduler**: only the master process should call `start()`. Other workers can still `enqueue`/`cancel`/`replay`/`list` — they simply skip `start()`.
- **Backpressure**: tune `DT_MAX_WEIGHT` to match downstream capacity (HTTP API limits, DB pool, etc.).
- **Crash recovery**: a process crash mid-execution leaves a task in `<NS>:PENDING:task-<id>` with `status = "running"`. The scheduler does not re-pick it on restart; expose an admin route to surface and `replay` it.

---

[← Back to README](../README.md) · [NestJS guide →](./nestjs.md)

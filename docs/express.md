[← Back to README](../README.md) · [NestJS guide →](./nestjs.md)

# Express integration

This guide shows how to wire `@naskot/node-dispatched-tasks` v2 (pure-Redis) into an Express app.

> Configuration rule: do **not** read `process.env` inside the library code.
> Read env values in the service layer below, then pass plain config to the library.

> Single-master rule: the scheduler must run on **only one process** (typically PM2 instance `0`). Your bootstrap code is responsible for that gate.

---

## 1) Service file

A thin wrapper that owns the lib lifecycle and is reused by routes.

`src/services/delayed-tasks.service.ts`

```ts
import IORedis from "ioredis";
import { DelayedTaskService } from "@naskot/node-dispatched-tasks";

const config = {
  redis: {
    host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.DT_REDIS_PORT ?? 6379),
    password: process.env.DT_REDIS_PASSWORD ?? undefined,
  },
  namespace: process.env.DT_NAMESPACE ?? "delayed-tasks",
  maxTasks: Number(process.env.DT_MAX_TASKS ?? 5),
  pollIntervalMs: Number(process.env.DT_POLL_INTERVAL_MS ?? 1000),
};

export const redis = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

export const delayedTaskService = new DelayedTaskService({
  redis,
  namespace: config.namespace,
  maxTasks: config.maxTasks,
  pollIntervalMs: config.pollIntervalMs,
  logger: console,
});

export async function startDelayedTasks() {
  // Only the master process should start the scheduler.
  const isMaster =
    process.env.NODE_APP_INSTANCE === undefined ||
    process.env.NODE_APP_INSTANCE === "0";
  if (isMaster) {
    delayedTaskService.start();
  }
}

export async function stopDelayedTasks() {
  await delayedTaskService.stop();
  await redis.quit();
}
```

---

## 2) A handler file (`*.task.ts`)

Single `defineTask({...})` exported as default.

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

Register it on boot:

```ts
import helloWorld from "./jobs/delayed-task/hello-world.task.js";
delayedTaskService.register(helloWorld);
```

---

## 3) Routes

`src/routes/delayed-task.routes.ts`

```ts
import { Router } from "express";
import { delayedTaskService } from "../services/delayed-tasks.service.js";

export const delayedTaskRouter = Router();

delayedTaskRouter.post("/tasks", async (req, res) => {
  const { name, data, scheduledAt, weight } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name required" });
  if (!delayedTaskService.has(name)) return res.status(404).json({ error: `unknown task '${name}'` });
  const record = await delayedTaskService.enqueue({
    name,
    data,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    weight,
  });
  res.status(202).json(record);
});

delayedTaskRouter.get("/tasks/:id", async (req, res) => {
  const record = await delayedTaskService.get(Number(req.params.id));
  if (!record) return res.status(404).end();
  res.json(record);
});

delayedTaskRouter.get("/tasks", async (_req, res) => {
  const [pending, finished, canceled] = await Promise.all([
    delayedTaskService.list.pending(),
    delayedTaskService.list.finished(),
    delayedTaskService.list.canceled(),
  ]);
  res.json({ pending, finished, canceled });
});

delayedTaskRouter.post("/tasks/:id/cancel", async (req, res) => {
  const r = await delayedTaskService.cancel(Number(req.params.id));
  if (!r) return res.status(404).end();
  res.json(r);
});

delayedTaskRouter.post("/tasks/:id/replay", async (req, res) => {
  const { scheduledAt } = req.body ?? {};
  const r = await delayedTaskService.replay(Number(req.params.id), {
    scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
  });
  if (!r) return res.status(404).end();
  res.json(r);
});
```

---

## 4) App bootstrap

`src/index.ts`

```ts
import express from "express";
import { delayedTaskRouter } from "./routes/delayed-task.routes.js";
import { delayedTaskService, startDelayedTasks, stopDelayedTasks } from "./services/delayed-tasks.service.js";
import helloWorld from "./jobs/delayed-task/hello-world.task.js";

async function main() {
  delayedTaskService.register(helloWorld);
  await startDelayedTasks();

  const app = express();
  app.use(express.json());
  app.use(delayedTaskRouter);

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => console.info(`Listening on :${String(port)}`));

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      server.close(() => undefined);
      void stopDelayedTasks().then(() => process.exit(0));
    });
  }
}

void main();
```

---

## 5) Production notes

- **Required envs (resolved in the service layer)**: `DT_REDIS_HOST`, `DT_REDIS_PORT`, optional `DT_REDIS_PASSWORD`, `DT_NAMESPACE`, `DT_MAX_TASKS`, `DT_POLL_INTERVAL_MS`.
- **Single scheduler**: enable `start()` only on the master process (PM2 `NODE_APP_INSTANCE === "0"` or equivalent). Other processes can still `enqueue`/`cancel`/`replay`/`list` against the same Redis namespace — they only skip `start()`.
- **Backpressure**: tune `DT_MAX_TASKS` to match downstream capacity.
- **Crash recovery**: a process crash mid-execution leaves a task in `<NS>:PENDING:task-<id>` with `status = "running"`. The scheduler will not re-pick it on restart; call `replay(id)` manually after moving it to `CANCELED`, or expose a small admin route.

---

[← Back to README](../README.md) · [NestJS guide →](./nestjs.md)

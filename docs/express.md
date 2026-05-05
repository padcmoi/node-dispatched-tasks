[← Back to README](../README.md) · [NestJS guide →](./nestjs.md) · [Database (no TypeORM)](./database.md)

# Express integration

This guide shows how to wire `@naskot/node-dispatched-tasks` into an Express app.

> Configuration rule: do **not** read `process.env` inside the library code.
> Read env values in the service layer below, then pass plain config to the library.

---

## 1) Service file

A thin wrapper that owns the lib lifecycle and is reused by routes.

`src/services/dispatched-task.service.ts`

```ts
import "reflect-metadata";
import IORedis from "ioredis";
import { DataSource } from "typeorm";
import { DispatchedTask, DispatchedTaskService, RedisPriorityIndex, TypeOrmTaskStore } from "@naskot/node-dispatched-tasks";

// 1. Read env in the service layer (NOT inside the library)
const config = {
  workerId: process.env.WORKER_ID ?? `${process.env.HOSTNAME ?? "worker"}-${String(process.pid)}`,
  redis: {
    host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.DT_REDIS_PORT ?? 6379),
    namespace: process.env.DT_REDIS_NAMESPACE ?? "dispatched-tasks",
  },
  db: {
    host: process.env.DT_DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DT_DB_PORT ?? 3306),
    database: process.env.DT_DB_NAME ?? "app",
    username: process.env.DT_DB_USER ?? "root",
    password: process.env.DT_DB_PASSWORD ?? "",
  },
  scheduler: {
    enabled: true,
    pollIntervalMs: 1000,
    promoteIntervalMs: 1000,
    maxConcurrentTasks: 10,
    maxConcurrentWeight: 100,
  },
};

// 2. Build a TypeORM DataSource that includes the lib's entity
export const dataSource = new DataSource({
  type: "mariadb",
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  username: config.db.username,
  password: config.db.password,
  entities: [DispatchedTask],
  synchronize: true, // dev-only; use migrations in production
  logging: false,
});

// 3. Build a Redis client
export const redis = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
});

// 4. Wire the service
export const dispatchedTaskService = new DispatchedTaskService({
  store: new TypeOrmTaskStore({ repository: dataSource.getRepository(DispatchedTask) }),
  priority: new RedisPriorityIndex({ redis, namespace: config.redis.namespace }),
  workerId: config.workerId,
  scheduler: config.scheduler,
  logger: console,
});

// 5. Lifecycle
export async function startDispatchedTasks() {
  await dataSource.initialize();
  await dispatchedTaskService.start();
}

export async function stopDispatchedTasks() {
  await dispatchedTaskService.stop();
  await redis.quit();
  await dataSource.destroy();
}
```

---

## 2) A handler file (`*.task.ts`)

The same shape your project uses for cron jobs: a single `defineTask({...})` exported as default.

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

Register it on boot:

```ts
import helloWorld from "./jobs/dispatched-tasks/hello-world.task.js";
dispatchedTaskService.register(helloWorld);
```

---

## 3) Routes

`src/routes/dispatched-task.routes.ts`

```ts
import { Router } from "express";
import { dispatchedTaskService } from "../services/dispatched-task.service.js";

export const dispatchedTaskRouter = Router();

dispatchedTaskRouter.post("/tasks", async (req, res) => {
  const { code, payload, idempotencyKey, scheduledAt, weight, priority, correlationId } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "code required" });
  const record = await dispatchedTaskService.enqueue({
    code,
    payload,
    idempotencyKey,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    weight,
    priority,
    correlationId,
    source: "http",
    sourceMeta: { ip: req.ip },
  });
  res.status(202).json({ publicId: record.publicId, status: record.status });
});

dispatchedTaskRouter.get("/tasks/:publicId", async (req, res) => {
  const record = await dispatchedTaskService.get(req.params.publicId);
  if (!record) return res.status(404).end();
  res.json(record);
});

dispatchedTaskRouter.get("/tasks", async (req, res) => {
  const list = await dispatchedTaskService.list({
    code: req.query.code as string | undefined,
    limit: Number(req.query.limit ?? 50),
  });
  res.json(list);
});

dispatchedTaskRouter.post("/tasks/:publicId/retry", async (req, res) => {
  const r = await dispatchedTaskService.retry(req.params.publicId);
  if (!r) return res.status(404).end();
  res.json(r);
});

dispatchedTaskRouter.post("/tasks/:publicId/cancel", async (req, res) => {
  const r = await dispatchedTaskService.cancel(req.params.publicId);
  if (!r) return res.status(404).end();
  res.json(r);
});
```

---

## 4) App bootstrap

`src/index.ts`

```ts
import express from "express";
import { dispatchedTaskRouter } from "./routes/dispatched-task.routes.js";
import { dispatchedTaskService, startDispatchedTasks, stopDispatchedTasks } from "./services/dispatched-task.service.js";
import helloWorld from "./jobs/dispatched-tasks/hello-world.task.js";

async function main() {
  dispatchedTaskService.register(helloWorld);

  await startDispatchedTasks();

  const app = express();
  app.use(express.json());
  app.use(dispatchedTaskRouter);

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => console.info(`Listening on :${String(port)}`));

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      server.close(() => undefined);
      void stopDispatchedTasks().then(() => process.exit(0));
    });
  }
}

void main();
```

---

## 5) Custom table name (optional)

Default SQL table is `dispatched_task`. To override it (and rename its indexes accordingly), pass `tableName` to the `DispatchedTaskService` constructor and use `taskStoreFactory` so the store is built lazily AFTER the DataSource is initialized:

```ts
import { DispatchedTask, DispatchedTaskService, RedisPriorityIndex, TypeOrmTaskStore } from "@naskot/node-dispatched-tasks";
import { DataSource } from "typeorm";
import IORedis from "ioredis";

// Read env in the service layer (NOT inside the library).
const tableName = process.env.DT_TABLE_NAME;

// Build but do NOT initialize the DataSource yet.
export const dataSource = new DataSource({
  type: "mariadb",
  entities: [DispatchedTask],
  // ... other options
});
const redis = new IORedis(/* ... */);

// Construct the service first — it applies `tableName` to the entity metadata immediately.
export const dispatchedTaskService = new DispatchedTaskService({
  tableName,
  taskStoreFactory: () => new TypeOrmTaskStore({ repository: dataSource.getRepository(DispatchedTask) }),
  priority: new RedisPriorityIndex({ redis, namespace: "dispatched-tasks" }),
  workerId: process.env.WORKER_ID ?? "express-worker",
  scheduler: { enabled: true },
});

// Initialize the DataSource AFTER service construction.
await dataSource.initialize();
await dispatchedTaskService.start();
```

Alternative — if you prefer to apply the override yourself before any service is built, the standalone `configureDispatchedTask({ tableName })` is also exported and is what the service uses internally.

Notes:

- Empty or unset `tableName` keeps the default `dispatched_task`.
- The override is idempotent: subsequent attempts to change the table name are no-ops.
- The Redis namespace (`new RedisPriorityIndex({ namespace: ... })`) is a **separate** concern; it has nothing to do with the SQL table name and should not be set to the same value.

---

## 6) Production notes

- **Required envs (resolved in the service layer)**: `DT_REDIS_HOST`, `DT_REDIS_PORT`, `DT_REDIS_NAMESPACE`, `DT_DB_HOST`, `DT_DB_PORT`, `DT_DB_NAME`, `DT_DB_USER`, `DT_DB_PASSWORD`, optionally `WORKER_ID`.
- **Migrations**: replace `synchronize: true` with a migration generated against the `DispatchedTask` entity.
- **PM2 cluster**: enable scheduler on every worker — the atomic `ZPOPMIN` claim guarantees only one worker picks each task.
- **Backpressure**: tune `maxConcurrentTasks` and `maxConcurrentWeight` to match your downstream capacity (DB pool, external API rate limits, etc.).
- **Validation**: prefer attaching a Zod `inputSchema` to every task — fails fast at enqueue time instead of mid-execution.

---

[← Back to README](../README.md) · [NestJS guide →](./nestjs.md)

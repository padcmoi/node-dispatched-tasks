# `@naskot/node-dispatched-tasks` — POC

End-to-end demonstration that the lib works under both **Express** and **NestJS**, with persistence in **MariaDB** (TypeORM) and priority indexing in **Redis**.

## Topology

```
                      ┌──────────────────────────┐
       1 task         │   nestjs-tasks-owner     │   2 fetches sortants
   ┌────────────────► │   (lib + scheduler +     │ ────────────┐
   │                  │   handlers in            │             │
   │   ┌────────────► │   jobs/dispatched-tasks/)│             │
   │   │              └──────────────────────────┘             │
   │   │   2 fetches entrants (1 chacun)                       │
   │   │ ◄──────────────────────────────────────────────────┐  │
┌──┴───┴──────┐                                       ┌─────┴──┴──────┐
│ express-    │                                       │ nestjs-       │
│ emitter     │                                       │ emitter       │
└─────────────┘                                       └───────────────┘
```

- **`nestjs-tasks-owner`** holds the dispatched-task scheduler (the lib running in scheduler mode). It exposes `POST /tasks` to receive task creation requests and runs registered handlers.
- **`express-emitter`** boots and posts a `ECHO_FROM_EXPRESS` task to the owner. It exposes `POST /echo` and `POST /from-nestjs` to receive the two callback fetches.
- **`nestjs-emitter`** boots and posts a `ECHO_FROM_NESTJS` task to the owner. It exposes `POST /echo` and `POST /from-express` for the same purpose.

When both tasks run, each emitter receives **2** inbound fetches and the owner outputs **4** (2 per task).

## Run

```bash
docker compose up --build
```

Stop & wipe:

```bash
docker compose down -v
```

## Inspect

| URL / Port              | What                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `http://localhost:8080` | phpMyAdmin (root / root) — browse the `DispatchedTask` table (custom name set via `DT_TABLE_NAME` env)                     |
| `localhost:6079`        | Redis (host port 6079 → container 6379) — point RedisInsight or `redis-cli -p 6079` here, namespace `dispatched-tasks-poc` |
| `http://localhost:3000` | `nestjs-tasks-owner` — `GET /tasks` to list, `GET /tasks/:publicId`, etc.                                                  |
| `http://localhost:3001` | `express-emitter`                                                                                                          |
| `http://localhost:3002` | `nestjs-emitter`                                                                                                           |

## Expected logs (abridged)

```
nestjs-tasks-owner | [dispatched-tasks] enqueued (ECHO_FROM_EXPRESS)
nestjs-tasks-owner | [dispatched-tasks] enqueued (ECHO_FROM_NESTJS)
nestjs-tasks-owner | [task ECHO_FROM_EXPRESS] sending to express-emitter and nestjs-emitter
nestjs-tasks-owner | [task ECHO_FROM_NESTJS] sending to express-emitter and nestjs-emitter
nestjs-tasks-owner | [dispatched-tasks] task succeeded ECHO_FROM_EXPRESS
nestjs-tasks-owner | [dispatched-tasks] task succeeded ECHO_FROM_NESTJS
express-emitter    | received /echo from tasks-owner
express-emitter    | received /from-nestjs from tasks-owner
nestjs-emitter     | received /echo from tasks-owner
nestjs-emitter     | received /from-express from tasks-owner
```

## Manual probing

```bash
# Enqueue a fresh task by hand:
curl -X POST http://localhost:3000/tasks \
  -H "content-type: application/json" \
  -d '{"code":"ECHO_FROM_EXPRESS","payload":{"sender":"manual"}}'

# List recent tasks:
curl http://localhost:3000/tasks?limit=10

# Inspect one:
curl http://localhost:3000/tasks/<publicId>
```

## Custom table name

The lib lets you override the SQL table name. This POC demonstrates that:

- `docker-compose.yml` sets `DT_TABLE_NAME` on `nestjs-tasks-owner` (any SQL-valid identifier, e.g. `DispatchedTask`, `dispatched_task_v2`, `dispatched-task123`).
- `nestjs-tasks-owner/src/dispatched-tasks/dispatched-task.service.ts` passes `tableName: process.env.DT_TABLE_NAME` to the `DispatchedTaskService` options, alongside a `taskStoreFactory` so the store is built lazily after the DataSource is initialized.
- The DataSource provider returns an **uninitialized** DataSource; `dataSource.initialize()` is called in `onApplicationBootstrap` AFTER the service constructor has applied the table-name override.
- Result: in phpMyAdmin you see whatever table name you set, instead of the default `dispatched_task`.

Unset the variable to fall back to the default `dispatched_task`.

## Files of interest

- `nestjs-tasks-owner/src/jobs/dispatched-tasks/*.task.ts` — handler shape (one `defineTask({...})` exported as default, mirroring the boilerplate's cron jobs).
- `nestjs-tasks-owner/src/dispatched-tasks/dispatched-task.service.ts` — provider that wires the lib.
- `express-emitter/src/index.ts` — the simplest possible Express integration (no scheduler — purely producer + callback receiver).
- `nestjs-emitter/src/main.ts` — same idea in Nest.

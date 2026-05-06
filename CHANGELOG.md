# CHANGELOG

## [Unreleased] - yyyy-mm-dd

- Pure-Redis storage. No MariaDB, no TypeORM, no entity, no migrations.
- Four buckets per namespace: `<NS>:PENDING:task-<id>`, `<NS>:FINISH:task-<id>` (success), `<NS>:FAILED:task-<id>` (handler error / timeout / no handler), `<NS>:CANCELED:task-<id>` (replayable).
- Auto-increment integer IDs via `INCR <NS>:counter`.
- Polling scheduler (default 1000ms), processes pending tasks in ID order when `scheduledAt <= now`.
- Weight-aware execution capped by `maxWeight` (default 5): a task starts only if `Σ(running.weight) + task.weight <= maxWeight`.
- Service API: `enqueue`, `cancel`, `replay`, `setWeight`, `get`, `has`, `list.pending`, `list.finished`, `list.failed`, `list.canceled`, `start`, `stop`.
- `enqueue` clamps `weight` to the live `maxWeight`. `setWeight(id, weight)` updates a still-pending task's weight (also clamped) — useful when `maxWeight` was lowered between deploys.
- Cancelled or failed tasks can be replayed; `replay(id)` auto-detects the source bucket (`CANCELED` or `FAILED`) and accepts an optional future `scheduledAt` (otherwise keeps the original).
- `scheduledAt` accepts `Date`, `number` (seconds from now), or `string` (ISO date or numeric seconds-from-now).
- `resolveScheduledAt` exported as a public utility.
- POC emitters accept `scheduledAt` and `weight` via query string.
- Removed: `TypeOrmTaskStore`, `RedisPriorityIndex`, `DispatchedTask` entity, `configureDispatchedTask`, `tableName`, `taskStoreFactory`, `idempotencyKey`, `correlationId`, `source`, `callback`, ULID generator, retry/backoff, Zod `inputSchema` validation.
- Removed peer dependencies: `typeorm`, `zod`. Only `ioredis` remains.

## [0.1.1] - 2026-05-05

- `tableName` and `taskStoreFactory` options on `DispatchedTaskService`.
- `configureDispatchedTask` exported.
- POC reads `DT_TABLE_NAME` from env.
- Dual-package `exports` with per-condition types (CJS + ESM).
- POC tsconfigs use `Node16` + `rootDir`.
- Lib `tsconfig.json` drops hardcoded `types: ["node"]`.
- `docs/database.md` guide for using the lib without TypeORM (canonical MariaDB DDL + custom `TaskStore`).

## [0.1.0] - 2026-05-05

- Public service `DispatchedTaskService` (register / enqueue / get / list / retry / cancel / start / stop).
- Handler factory `defineTask`.
- TypeORM store adapter and `DispatchedTask` entity.
- Redis priority index adapter with configurable namespace.
- Token-bucket scheduler with atomic claim, timeout, retry/backoff.
- Boot recovery from MariaDB.
- Idempotent enqueue via `idempotencyKey`.
- Scheduled tasks via `scheduledAt`.
- ULID `public_id` generator.
- Custom error types.
- Pluggable `Logger` interface.
- `source` column as SQL `ENUM`.
- POC stack (MariaDB, Redis, phpMyAdmin, NestJS holder, Express emitter, NestJS emitter).
- README, Express guide, NestJS guide.
- Unit tests with in-memory fixtures.

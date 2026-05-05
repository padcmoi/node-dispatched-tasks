# CHANGELOG

## [Unreleased] - yyyy-mm-dd

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

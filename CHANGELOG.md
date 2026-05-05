# CHANGELOG

## [Unreleased] - yyyy-mm-dd

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

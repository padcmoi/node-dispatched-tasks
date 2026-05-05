[← Back to README](../README.md) · [Express guide](./express.md) · [NestJS guide](./nestjs.md)

# Database integration without TypeORM

`@naskot/node-dispatched-tasks` does not require TypeORM. The lib only depends on the `TaskStore` **interface** — `TypeOrmTaskStore` is one implementation it ships for convenience. You can write your own against any database driver (`mysql2`, `mariadb`, `knex`, `drizzle`, raw SQL, …) and pass it to `DispatchedTaskService`.

This guide shows the canonical MariaDB schema and the shape of a hand-rolled `TaskStore`.

---

## 1) Standard MariaDB schema

Default table name: `dispatched_task`. Apply this DDL once (manually, via your migration tool, or via your CI):

```sql
CREATE TABLE `dispatched_task` (
  `id`               BIGINT UNSIGNED       NOT NULL AUTO_INCREMENT,
  `public_id`        CHAR(26)              NOT NULL,
  `code`             VARCHAR(191)          NOT NULL,
  `payload`          JSON                  NULL,
  `weight`           INT UNSIGNED          NOT NULL,
  `status`           VARCHAR(16)           NOT NULL DEFAULT 'pending',
  `priority`         INT                   NULL,
  `attempts`         INT UNSIGNED          NOT NULL DEFAULT 0,
  `max_attempts`     INT UNSIGNED          NOT NULL,
  `scheduled_at`     DATETIME(3)           NULL,
  `claimed_at`       DATETIME(3)           NULL,
  `claimed_by`       VARCHAR(191)          NULL,
  `started_at`       DATETIME(3)           NULL,
  `completed_at`     DATETIME(3)           NULL,
  `last_error`       TEXT                  NULL,
  `source`           ENUM('http','amqp','cron','internal') NOT NULL,
  `source_meta`      JSON                  NULL,
  `callback`         JSON                  NULL,
  `result`           JSON                  NULL,
  `correlation_id`   VARCHAR(191)          NULL,
  `idempotency_key`  VARCHAR(191)          NULL,
  `created_at`       DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dispatched_task_public_id`       (`public_id`),
  UNIQUE KEY `uq_dispatched_task_idempotency_key` (`idempotency_key`),
  KEY        `ix_dispatched_task_status`          (`status`),
  KEY        `ix_dispatched_task_code`            (`code`),
  KEY        `ix_dispatched_task_created_at`      (`created_at`),
  KEY        `ix_dispatched_task_correlation_id`  (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes:

- `public_id` is a 26-char ULID — used as the externally visible identifier.
- `idempotency_key` is `UNIQUE` only on non-NULL values. Most database engines do that natively (NULLs are not considered duplicates by `UNIQUE`); on engines that disagree, use a partial/conditional unique index.
- `status` legal values: `pending`, `claimed`, `running`, `succeeded`, `failed`, `dead`, `cancelled` (the lib's `TaskStatus` type).

---

## 2) Implement `TaskStore` against this schema

Skeleton using `mysql2/promise` (any other driver works the same way — only the SQL execution lines change).

```ts
import type { TaskStore } from "@naskot/node-dispatched-tasks";
import type { NewTaskRecord, TaskListFilters, TaskRecord, TaskStatus } from "@naskot/node-dispatched-tasks";
import type { Pool } from "mysql2/promise";

export class Mysql2TaskStore implements TaskStore {
  constructor(private readonly pool: Pool) {}

  async insert(input: NewTaskRecord): Promise<TaskRecord> {
    const [result] = await this.pool.execute(
      `INSERT INTO dispatched_task
        (public_id, code, payload, weight, status, priority, max_attempts, scheduled_at,
         source, source_meta, callback, correlation_id, idempotency_key)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.publicId,
        input.code,
        input.payload === null ? null : JSON.stringify(input.payload),
        input.weight,
        input.priority,
        input.maxAttempts,
        input.scheduledAt,
        input.source,
        input.sourceMeta === null ? null : JSON.stringify(input.sourceMeta),
        input.callback === null ? null : JSON.stringify(input.callback),
        input.correlationId,
        input.idempotencyKey,
      ]
    );
    // result.insertId, etc. — fetch the inserted row back to return a complete TaskRecord:
    return this.requireByPublicId(input.publicId);
  }

  async getByPublicId(publicId: string) {
    const [rows] = await this.pool.execute(`SELECT * FROM dispatched_task WHERE public_id = ? LIMIT 1`, [publicId]);
    return mapRow((rows as any[])[0] ?? null);
  }

  async getByIdempotencyKey(key: string) {
    const [rows] = await this.pool.execute(`SELECT * FROM dispatched_task WHERE idempotency_key = ? LIMIT 1`, [key]);
    return mapRow((rows as any[])[0] ?? null);
  }

  async claim(publicId: string, claimedBy: string) {
    const [result] = await this.pool.execute(
      `UPDATE dispatched_task
         SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP(3), claimed_by = ?, attempts = attempts + 1
       WHERE public_id = ? AND status IN ('pending','failed')`,
      [claimedBy, publicId]
    );
    if ((result as any).affectedRows === 0) return null;
    return this.getByPublicId(publicId);
  }

  async markStarted(publicId: string) {
    await this.pool.execute(
      `UPDATE dispatched_task SET status = 'running', started_at = CURRENT_TIMESTAMP(3) WHERE public_id = ?`,
      [publicId]
    );
  }

  async markSucceeded(publicId: string, result: unknown) {
    await this.pool.execute(
      `UPDATE dispatched_task
         SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP(3), result = ?, last_error = NULL
       WHERE public_id = ?`,
      [result === null || result === undefined ? null : JSON.stringify(result), publicId]
    );
  }

  async markFailed(publicId: string, error: string, willRetry: boolean) {
    if (willRetry) {
      await this.pool.execute(`UPDATE dispatched_task SET status = 'failed', last_error = ? WHERE public_id = ?`, [
        error,
        publicId,
      ]);
    } else {
      await this.pool.execute(
        `UPDATE dispatched_task
           SET status = 'dead', completed_at = CURRENT_TIMESTAMP(3), last_error = ?
         WHERE public_id = ?`,
        [error, publicId]
      );
    }
  }

  async resetForRetry(publicId: string, scheduledAt: Date | null) {
    const [result] = await this.pool.execute(
      `UPDATE dispatched_task
         SET status = 'pending', scheduled_at = ?,
             claimed_at = NULL, claimed_by = NULL, started_at = NULL, completed_at = NULL
       WHERE public_id = ?`,
      [scheduledAt, publicId]
    );
    if ((result as any).affectedRows === 0) return null;
    return this.getByPublicId(publicId);
  }

  async cancel(publicId: string) {
    const [result] = await this.pool.execute(
      `UPDATE dispatched_task
         SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP(3)
       WHERE public_id = ? AND status IN ('pending','failed')`,
      [publicId]
    );
    if ((result as any).affectedRows === 0) return null;
    return this.getByPublicId(publicId);
  }

  async list(filters: TaskListFilters) {
    // Build a parametrised query from filters.status / filters.code / filters.correlationId / etc.
    // Omitted for brevity.
    const [rows] = await this.pool.execute(`SELECT * FROM dispatched_task ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
      filters.limit ?? 50,
      filters.offset ?? 0,
    ]);
    return (rows as any[]).map(mapRow).filter(Boolean) as TaskRecord[];
  }

  async pendingOrRunning() {
    const [rows] = await this.pool.execute(
      `SELECT * FROM dispatched_task
         WHERE status IN ('pending','claimed','running','failed')
       ORDER BY created_at ASC`
    );
    return (rows as any[]).map(mapRow).filter(Boolean) as TaskRecord[];
  }

  private async requireByPublicId(publicId: string) {
    const r = await this.getByPublicId(publicId);
    if (!r) throw new Error(`Task ${publicId} disappeared right after insert`);
    return r;
  }
}

function mapRow(row: any): TaskRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    publicId: row.public_id,
    code: row.code,
    payload: row.payload,
    weight: row.weight,
    status: row.status as TaskStatus,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    source: row.source,
    sourceMeta: row.source_meta,
    callback: row.callback,
    result: row.result,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

---

## 3) Wire it into `DispatchedTaskService`

```ts
import mysql from "mysql2/promise";
import IORedis from "ioredis";
import { DispatchedTaskService, RedisPriorityIndex } from "@naskot/node-dispatched-tasks";
import { Mysql2TaskStore } from "./mysql2-task-store";

const pool = await mysql.createPool({
  host: "...",
  port: 3306,
  user: "...",
  password: "...",
  database: "...",
});

const redis = new IORedis({ host: "...", port: 6379 });

const dispatchedTaskService = new DispatchedTaskService({
  store: new Mysql2TaskStore(pool),
  priority: new RedisPriorityIndex({ redis, namespace: "dispatched-tasks" }),
  workerId: "manual-worker",
  scheduler: { enabled: true },
});

await dispatchedTaskService.start();
```

Notice: no `tableName`, no `taskStoreFactory`, no `configureDispatchedTask`. Those exist only for the TypeORM adapter; with a hand-rolled store you simply hardcode the table name in your SQL.

---

## 4) Production notes

- Use a connection pool. The lib executes queries from the scheduler tick + every enqueue/get/list/retry/cancel call.
- Wrap the `claim` UPDATE in a transaction if your driver doesn't already make single-statement UPDATEs atomic on `InnoDB` (most do).
- The Redis priority index is **always** required regardless of which `TaskStore` you choose — the scheduler relies on `ZPOPMIN` for atomic claim across workers. If you don't want Redis, implement your own `PriorityIndex`.
- Migrations: bring your own. The lib doesn't ship migration tooling outside the TypeORM adapter convention.

---

[← Back to README](../README.md) · [Express guide](./express.md) · [NestJS guide](./nestjs.md)

# @naskot/node-dispatched-tasks

> Persisted, weight-aware async task dispatcher for Node microservices.
> Hybrid storage: **MariaDB** (source of truth, via TypeORM) + **Redis** (priority index).
> Framework-agnostic — works the same way under **Express** or **NestJS**.

## What problem does it solve?

When microservices exchange work over HTTP or RabbitMQ, the receiver often needs to:

- Persist the request so it survives a crash.
- Schedule work fairly across many concurrent requests.
- Cap how much load is in flight at any time.
- Retry transient failures with backoff.
- Optionally defer work ("run this Friday at 14:00").
- Optionally deduplicate retransmissions ("this is the same request, don't run twice").
- Stay agnostic to the HTTP framework wrapping it.

`@naskot/node-dispatched-tasks` provides exactly that primitive: a **task service** that you wire into any Node app.
You register handler functions with a stable `code`. You enqueue tasks by `code`. The library persists, schedules, claims atomically across workers, executes, retries, and reports — independently of how the request arrived.

## Architecture in one minute

```
┌──────────────────┐  enqueue(code, payload)   ┌────────────────────┐
│ HTTP / AMQP /    │ ────────────────────────► │ DispatchedTaskSvc  │
│ Cron / Internal  │                            └─────────┬──────────┘
└──────────────────┘                                       │
                                                           ▼
                                              ┌────────────────────────┐
                                              │ MariaDB (TypeORM)      │   <— source of truth
                                              │ table dispatched_task  │
                                              └────────────┬───────────┘
                                                           │
                                                           ▼
                                              ┌────────────────────────┐
                                              │ Redis ZSET (priority)  │   <— scheduling index
                                              │ ZPOPMIN atomic claim   │
                                              └────────────┬───────────┘
                                                           │
                                                           ▼
                                              ┌────────────────────────┐
                                              │ Scheduler              │
                                              │ - token bucket         │
                                              │ - timeout / abort      │
                                              │ - retry / backoff      │
                                              └────────────┬───────────┘
                                                           │ run()
                                                           ▼
                                              ┌────────────────────────┐
                                              │ Your handler function  │
                                              └────────────────────────┘
```

- **MariaDB** holds the durable record. The DB is hit only at task creation, claim (PK lookup), and terminal state — never polled.
- **Redis** holds the operational priority index. The scheduler polls Redis (sub-millisecond) and uses `ZPOPMIN` for atomic claim across workers.
- **Recovery** at boot: any task left `pending` / `claimed` / `running` / `failed` is re-pushed into the index. Crashes do not lose work.

## Features

- **Persistent tasks** survive crashes (MariaDB).
- **Priority + FIFO** queue (Redis ZSET, score = `-priority * 1e13 + createdAt`).
- **Weight-based capacity** (token bucket): scheduler picks tasks while `Σ(running.weight) ≤ MAX_CONCURRENT_WEIGHT`, with an additional `MAX_CONCURRENT_TASKS` cap.
- **Multi-worker safe**: `ZPOPMIN` is atomic in Redis — N PM2 workers can run the scheduler concurrently without locking.
- **Retry with backoff**: `linear`, `exp`, `fixed`, or custom `fn` per task.
- **Timeout** with `AbortSignal` propagated to the handler.
- **Scheduled tasks**: pass `scheduledAt` to defer execution.
- **Idempotency** (opt-in): pass `idempotencyKey` to dedupe duplicate submissions.
- **Admin operations**: `get`, `list`, `retry`, `cancel`.
- **Validation** (opt-in): pass a `inputSchema` (Zod) and the lib validates before persistence.
- **Configurable Redis namespace** so multiple consumers can share a Redis instance without collision.
- **Framework-agnostic**: no Express, no NestJS, no HMAC dependency. Wire it however you want.

## Configuration rule

> The library never reads `process.env`.
> Read environment variables in your service/provider layer, then pass plain config objects (Redis client, TypeORM Repository, options) to the library.

This keeps the library deterministic and testable, and lets each consumer (Express, NestJS, Lambda, etc.) handle env injection in its own idiomatic way.

### Custom table name (optional)

The default SQL table name is `dispatched_task`. Pass `tableName` to the `DispatchedTaskService` constructor to override it (table + index names) — the service applies it before any TypeORM `DataSource` is initialized. See the [Express](./docs/express.md) and [NestJS](./docs/nestjs.md) integration guides for runnable examples.

## Install

```bash
npm i @naskot/node-dispatched-tasks
```

Peer dependencies (you bring your own version):

```bash
npm i ioredis typeorm zod reflect-metadata
```

## Integration guides

- [Express](./docs/express.md) — service file, routes, handler, end-to-end snippet.
- [NestJS](./docs/nestjs.md) — module, provider, controller, handler, end-to-end snippet.
- [Database (without TypeORM)](./docs/database.md) — canonical MariaDB schema and a hand-rolled `TaskStore` skeleton.

## POC

A runnable end-to-end POC lives in [`./poc`](./poc) :

```
docker compose up --build
```

It boots three apps (1 NestJS task holder + 1 Express emitter + 1 NestJS emitter), MariaDB, Redis, and phpMyAdmin. The two emitters dispatch tasks to the holder, the holder runs them and fetches back to both. Logs + phpMyAdmin (`http://localhost:8080`) + RedisInsight (`localhost:6079`) let you observe everything.

## Public API

```ts
// Service
class DispatchedTaskService {
  constructor(options: DispatchedTaskServiceOptions); // accepts `tableName?` and `taskStoreFactory?` (lazy alternative to `store`)
  register(definition: TaskDefinition): void;
  enqueue(input: EnqueueInput): Promise<TaskRecord>;
  get(publicId: string): Promise<TaskRecord | null>;
  list(filters: TaskListFilters): Promise<TaskRecord[]>;
  retry(publicId: string): Promise<TaskRecord | null>;
  cancel(publicId: string): Promise<TaskRecord | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// Handler factory
function defineTask<P, R>(input: DefineTaskInput<P, R>): TaskDefinition<P, R>;

// Adapters
class TypeOrmTaskStore implements TaskStore;
class RedisPriorityIndex implements PriorityIndex;

// Entity (TypeORM, register in your DataSource)
class DispatchedTask;                                   // table name "dispatched_task" by default
function configureDispatchedTask(opts: { tableName?: string }); // optional override of table + index names
```

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## Notes

- **Node**: requires Node ≥ 18.
- **Decorators**: TypeORM entity uses experimental decorators. Consumers must enable `experimentalDecorators` and `emitDecoratorMetadata` in their `tsconfig.json`, and `import "reflect-metadata"` once at process start.
- **Migrations**: the library does not run migrations. Either let TypeORM `synchronize: true` create the table in dev, or generate a migration with `typeorm migration:generate` against the entity.
- **Multi-leader**: by default any worker can run the scheduler. Atomic claim via `ZPOPMIN` makes this safe.
- **Time**: schedule times are stored as `datetime(3)` in MariaDB. The scheduler treats `scheduledAt <= now` as ready.

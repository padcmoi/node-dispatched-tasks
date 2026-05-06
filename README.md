# @naskot/node-dispatched-tasks

> Lightweight Redis-backed delayed-task scheduler for Node microservices.
> Weight-aware execution, integer auto-increment IDs, framework-agnostic.

## What it does

Persist a task in Redis with a name (matching a registered handler), a `data` payload, a `scheduledAt` (Date or timestamp), and a `weight`. The library polls Redis once per second (configurable), picks every pending task whose `scheduledAt` is in the past, and executes the registered handler — provided the running weight stays under a configurable cap (`maxWeight`, default 5).

Tasks transition between four Redis buckets:

```
<NS>:PENDING:task-<id>     ← created or replayed
<NS>:FINISH:task-<id>      ← succeeded
<NS>:FAILED:task-<id>      ← handler threw, timed out, or no handler registered
<NS>:CANCELED:task-<id>    ← cancelled (can be replayed)
```

IDs are integers, auto-incremented via `INCR <NS>:counter`.

## Configuration rule

The library never reads `process.env`. The host application reads env in its service/provider layer and passes plain options.

Required:

- `redis` — an `ioredis` `Redis` instance, already created.
- `namespace` — Redis key namespace (e.g. `delayed-tasks`).

Optional:

- `maxWeight` — cap on the sum of running task weights (default `5`).
- `pollIntervalMs` — scheduler tick interval (default `1000`).
- `logger` — `Logger` (`info`, `warn`, `error`, optional `debug`).

## Single-master rule

The scheduler must run on **only one process** at a time (typically PM2 instance `0`).
The library does not detect this — your bootstrap code must call `service.start()` only on the master process and `service.stop()` on shutdown.

## Install

```bash
npm i @naskot/node-dispatched-tasks ioredis
```

## Integration guides

- [Express](./docs/express.md) — service file, routes, handler, end-to-end snippet.
- [NestJS](./docs/nestjs.md) — module, provider, controller, handler, end-to-end snippet.

## POC

A runnable end-to-end POC lives in [`./poc`](./poc):

```
docker compose up --build
```

Boots Redis + RedisInsight + a NestJS owner (handlers + scheduler) + a NestJS emitter and an Express emitter (both producer-only). See [`poc/README.md`](./poc/README.md).

## API

```ts
class DelayedTaskService {
  constructor(options: DelayedTaskServiceOptions);

  register(definition: TaskDefinition): void;
  has(name: string): boolean;

  enqueue(input: EnqueueInput): Promise<TaskRecord>;
  cancel(id: number): Promise<TaskRecord | null>;
  replay(id: number, options?: ReplayOptions): Promise<TaskRecord | null>;
  setWeight(id: number, weight: number): Promise<TaskRecord | null>;
  get(id: number): Promise<TaskRecord | null>;

  list: {
    pending(): Promise<TaskRecord[]>;
    finished(): Promise<TaskRecord[]>;
    failed(): Promise<TaskRecord[]>;
    canceled(): Promise<TaskRecord[]>;
  };

  start(): Promise<void>;
  stop(): Promise<void>;
}

function defineTask<P, R>(input: TaskDefinition<P, R>): TaskDefinition<P, R>;
```

### Task definition

```
{
  name: "HELLO_WORLD",   // unique identifier matching enqueue input
  weight?: 1,            // default weight; overridable per enqueue
  timeoutMs?: 30_000,    // optional timeout (AbortSignal in ctx.signal)
  run: async (data, ctx) => { ... }
}
```

### Enqueue input

```
{
  name: "HELLO_WORLD",
  data?: any,                            // arbitrary serializable payload
  scheduledAt?: Date | number | string,  // see below
  weight?: 2,                            // overrides definition weight
}
```

`scheduledAt` accepts:

- `Date` — absolute date.
- `number` — number of **seconds from now** (e.g. `10` → 10 seconds from now).
- `string` — either an ISO date (`"2026-12-31T23:59:00Z"`) or numeric seconds-from-now (`"10"`).
- omitted/`undefined` — run immediately.

### Replay

```
service.replay(id);                                  // keep original scheduledAt
service.replay(id, { scheduledAt: 30 });             // re-run 30 seconds from now
service.replay(id, { scheduledAt: futureDate });     // re-run at a specific Date
service.replay(id, { scheduledAt: "2026-12-31T..." });
```

`scheduledAt` accepts the same shapes as `enqueue`. If omitted, the original `scheduledAt` is preserved — the scheduler may pick the task up immediately if that timestamp is already in the past.

## Lifecycle expectations

- **Cancel**: only valid for a pending task that has not yet started (`status === "pending"`). Returns `null` if the task is `running`, `finished`, `failed`, or already `canceled`.
- **Replay**: valid for a task in the `CANCELED` or `FAILED` bucket. The lib auto-detects which bucket the id lives in.
- **Failures**: a task whose handler throws (or whose `timeoutMs` elapses) is moved to `FAILED` with `status = "failed"` and a populated `error`.
- **Missing handler**: a pending task whose `name` is no longer registered is moved to `FAILED` with `status = "failed"`.

## Weight semantics

Each task has a `weight`. The scheduler maintains a running sum of weights of in-flight tasks and only starts the next pending task if the sum after start would not exceed `maxWeight`.

Examples with `maxWeight = 5`:

- task A (weight 3) and task B (weight 3) → only one runs at a time.
- task A (weight 3) and task B (weight 2) → both run concurrently.

Weights must be positive numbers.

### Clamping at enqueue

If `enqueue` is called with a `weight` that exceeds the current `maxWeight`, the value is **clamped** to `maxWeight` so the task can never be larger than the cap. The clamp uses the live `maxWeight` of the running service.

> Caveat: existing pending tasks are **not** rewritten when `maxWeight` changes between restarts. A task created with `weight: 8` while `maxWeight` was `10` keeps its `weight: 8` after a restart with `maxWeight: 5`, and the scheduler will refuse to ever start it (8 > 5). Use `setWeight(id, weight)` to bring it back below the cap, or `cancel` it.

### `setWeight(id, weight)`

Update the weight of a task that is still in the `PENDING` bucket and not yet running. The new value is also clamped to `maxWeight`. Returns `null` for unknown ids or tasks already in `running`/`finished`/`failed`/`canceled` state.

```ts
await service.setWeight(42, 4); // pending #42 now has weight 4
await service.setWeight(42, 99); // clamped to maxWeight (e.g. 5)
```

## Notes

- **Node**: requires Node ≥ 18.
- **Redis only**: no MariaDB, no TypeORM, no migrations. The library does not own the Redis connection — pass it in and dispose of it yourself.
- **Crash recovery**: a process crash mid-execution leaves the task in `PENDING` with `status = "running"`. On the next start, the scheduler ignores `running` rows; you can `replay` them manually if needed (future versions may auto-recover).

## License

MIT.

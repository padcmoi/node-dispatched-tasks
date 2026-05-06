# POC — node-dispatched-tasks v2

Runnable end-to-end demo of `@naskot/node-dispatched-tasks` v2 (pure-Redis).

```
docker compose up --build
```

Boots:

| Service              | Port | Role                                                                      |
| -------------------- | ---- | ------------------------------------------------------------------------- |
| `redis`              | 6379 | Redis (sole storage)                                                      |
| `redisinsight`       | 6079 | Browser UI for Redis (`http://localhost:6079`)                            |
| `nestjs-tasks-owner` | 4001 | NestJS owner — registers handlers, runs the scheduler, exposes /tasks     |
| `nestjs-emitter`     | 4002 | NestJS emitter (producer-only) — uses the lib to write directly to Redis  |
| `express-emitter`    | 4003 | Express emitter (producer-only) — uses the lib to write directly to Redis |

The owner is the **only** process that calls `service.start()`. Both emitters share the same Redis namespace as the owner: they create a `DelayedTaskService` instance, register task names with no-op handlers (so `enqueue` accepts them), and never call `start()`. The owner picks up their tasks on the next scheduler tick and runs the real handlers.

## Try it

```bash
# Owner: list registered tasks
curl http://localhost:4001/tasks/_handlers

# Emitter (NestJS): enqueue HELLO_WORLD now
curl -X POST 'http://localhost:4002/dispatch/HELLO_WORLD' \
  -H 'content-type: application/json' \
  -d '{"data":{"hello":"world"}}'

# Same, but scheduled 30s from now (numeric seconds-from-now)
curl -X POST 'http://localhost:4002/dispatch/HELLO_WORLD?scheduledAt=30'

# Or with an explicit ISO date
curl -X POST 'http://localhost:4002/dispatch/HELLO_WORLD?scheduledAt=2026-12-31T23:59:00Z'

# Emitter (Express): enqueue HEAVY (weight 3) in 5s
curl -X POST 'http://localhost:4003/dispatch/HEAVY?scheduledAt=5' \
  -H 'content-type: application/json' \
  -d '{"data":{"job":42}}'

# Owner: list pending / finished / canceled
curl http://localhost:4001/tasks

# Owner: cancel task #3
curl -X POST http://localhost:4001/tasks/3/cancel

# Owner: replay task #3 (works for canceled OR failed tasks — the lib auto-detects the bucket)
curl -X POST http://localhost:4001/tasks/3/replay -H 'content-type: application/json' -d '{}'
```

## Configuration

Edit `.env` (copy from `.env.example`).

import express from "express";
import { Redis } from "ioredis";
import { DelayedTaskService, defineTask } from "@naskot/node-dispatched-tasks";

const redis = new Redis({
  host: process.env.DT_REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.DT_REDIS_PORT ?? 6379),
  password: process.env.DT_REDIS_PASSWORD ?? undefined,
  maxRetriesPerRequest: null,
});

const lib = new DelayedTaskService({
  redis,
  namespace: process.env.DT_NAMESPACE ?? "delayed-tasks",
  maxTasks: 5,
  pollIntervalMs: 1000,
  logger: console,
});

const noop = () => undefined;
lib.register(defineTask({ name: "HELLO_WORLD", run: noop }));
lib.register(defineTask({ name: "HEAVY", weight: 3, run: noop }));

const app = express();
app.use(express.json());

app.post("/dispatch/:name", async (req, res) => {
  const name = req.params.name;
  if (!lib.has(name)) return res.status(404).json({ error: `unknown task '${name}'` });
  const body = (req.body ?? {}) as { data?: unknown; scheduledAt?: string; weight?: number };
  const record = await lib.enqueue({
    name,
    data: body.data,
    scheduledAt: resolveScheduledAt(body.scheduledAt),
    weight: body.weight,
  });
  res.status(202).json(record);
});

function resolveScheduledAt(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^\+(\d+)([smh])$/.exec(value);
  if (match) {
    const offset = Number(match[1]);
    const unit = match[2];
    const ms = unit === "s" ? offset * 1000 : unit === "m" ? offset * 60_000 : offset * 3_600_000;
    return new Date(Date.now() + ms);
  }
  return new Date(value);
}

const port = Number(process.env.PORT ?? 4003);
const server = app.listen(port, () => {
  console.info(`[express-emitter] listening on :${String(port)} (producer-only)`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    server.close();
    await lib.stop();
    if (redis.status !== "end") await redis.quit().catch(() => undefined);
    process.exit(0);
  });
}

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
  maxWeight: 5,
  pollIntervalMs: 1000,
  logger: console,
});

const noop = () => undefined;
lib.register(defineTask({ name: "HELLO_WORLD", run: noop }));
lib.register(defineTask({ name: "HEAVY", weight: 3, run: noop }));

const app = express();
app.use(express.json());

app.post("/dispatch/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    if (!lib.has(name)) return res.status(404).json({ error: `unknown task '${name}'` });
    const body = (req.body ?? {}) as { data?: unknown; scheduledAt?: string | number; weight?: number };
    const qScheduledAt = typeof req.query.scheduledAt === "string" ? req.query.scheduledAt : undefined;
    const qWeight = typeof req.query.weight === "string" ? Number(req.query.weight) : undefined;
    const record = await lib.enqueue({
      name,
      data: body.data,
      scheduledAt: qScheduledAt ?? body.scheduledAt,
      weight: qWeight ?? body.weight,
    });
    res.status(202).json(record);
  } catch (err) {
    next(err);
  }
});

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

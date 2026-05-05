import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Body, Controller, Module, NotFoundException, OnApplicationShutdown, Param, Post } from "@nestjs/common";
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

// Producer-only mode: register task names so enqueue() accepts them.
// Handlers are NEVER executed here because we never call lib.start().
const noop = () => undefined;
lib.register(defineTask({ name: "HELLO_WORLD", run: noop }));
lib.register(defineTask({ name: "HEAVY", weight: 3, run: noop }));

@Controller("dispatch")
class DispatchController implements OnApplicationShutdown {
  @Post(":name")
  async dispatch(
    @Param("name") name: string,
    @Body() body: { data?: unknown; scheduledAt?: string; weight?: number }
  ) {
    if (!lib.has(name)) throw new NotFoundException(`unknown task '${name}'`);
    return lib.enqueue({
      name,
      data: body?.data,
      scheduledAt: resolveScheduledAt(body?.scheduledAt),
      weight: body?.weight,
    });
  }

  async onApplicationShutdown() {
    await lib.stop();
    if (redis.status !== "end") await redis.quit().catch(() => undefined);
  }
}

@Module({ controllers: [DispatchController] })
class AppModule {}

function resolveScheduledAt(value: string | undefined) {
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4002);
  await app.listen(port, "0.0.0.0");
  console.info(`[nestjs-emitter] listening on :${String(port)} (producer-only)`);
}

void bootstrap();

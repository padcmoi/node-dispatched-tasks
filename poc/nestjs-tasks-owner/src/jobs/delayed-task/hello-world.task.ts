import { defineTask } from "@naskot/node-dispatched-tasks";

export default defineTask({
  name: "HELLO_WORLD",
  weight: 1,
  timeoutMs: 30_000,
  run: (data, ctx) => {
    console.info(`[task ${String(ctx.id)}] HELLO_WORLD`, data);
    return { ok: true, message: "hello world" };
  },
});

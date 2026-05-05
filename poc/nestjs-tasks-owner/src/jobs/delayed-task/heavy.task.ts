import { defineTask } from "@naskot/node-dispatched-tasks";

// Demonstrates the weight cap: with maxTasks=5 and weight=3, only one HEAVY runs at a time.
export default defineTask({
  name: "HEAVY",
  weight: 3,
  timeoutMs: 60_000,
  run: async (data, ctx) => {
    console.info(`[task ${String(ctx.id)}] HEAVY start`, data);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    console.info(`[task ${String(ctx.id)}] HEAVY done`);
    return { ok: true };
  },
});

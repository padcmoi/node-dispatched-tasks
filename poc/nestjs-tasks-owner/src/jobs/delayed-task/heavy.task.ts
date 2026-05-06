import { defineTask } from "@naskot/node-dispatched-tasks";

export interface HeavyData {
  job: number;
  label?: string;
}

// Demonstrates the weight cap (maxWeight=5, weight=3 → only one HEAVY runs at a time)
// AND the typed-data pattern: `data` is HeavyData inside `run`, and on `service.enqueue(heavy, { data })`.
export default defineTask<HeavyData, { ok: boolean }>({
  name: "HEAVY",
  weight: 3,
  timeoutMs: 60_000,
  run: async (data, ctx) => {
    console.info(`[task ${String(ctx.id)}] HEAVY start`, data);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    console.info(`[task ${String(ctx.id)}] HEAVY done job=${String(data.job)}`);
    return { ok: true };
  },
});

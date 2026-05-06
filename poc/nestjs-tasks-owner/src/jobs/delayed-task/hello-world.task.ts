import { defineTask } from "@naskot/node-dispatched-tasks";

export interface HelloWorldData {
  message?: string;
}

export interface HelloWorldResult {
  ok: true;
  greeted: string;
}

export default defineTask<HelloWorldData, HelloWorldResult>({
  name: "HELLO_WORLD",
  weight: 1,
  timeoutMs: 30_000,
  run: (data, ctx) => {
    const greeted = data.message ?? "world";
    console.info(`[task ${String(ctx.id)}] HELLO_WORLD → ${greeted}`);
    return { ok: true, greeted };
  },
});

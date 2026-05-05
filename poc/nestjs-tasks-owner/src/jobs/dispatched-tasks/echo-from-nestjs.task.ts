import { defineTask } from "@naskot/node-dispatched-tasks";
import { z } from "zod";

const EXPRESS_URL = process.env.EXPRESS_EMITTER_URL ?? "http://express-emitter:3000";
const NESTJS_URL = process.env.NESTJS_EMITTER_URL ?? "http://nestjs-emitter:3000";

const task = defineTask({
  code: "ECHO_FROM_NESTJS",
  weight: 1,
  maxAttempts: 3,
  timeoutMs: 15_000,
  inputSchema: z.object({ sender: z.string() }).passthrough(),
  run: async (payload, ctx) => {
    console.info("PAYLOAD", payload);
    console.info(`[task ${ctx.publicId}] ECHO_FROM_NESTJS firing fetches`, { sender: payload.sender });
    const body = JSON.stringify({ from: "tasks-owner", sender: payload.sender, taskId: ctx.publicId });
    const headers = { "content-type": "application/json" };
    const expressTarget = `${EXPRESS_URL}/from-nestjs`;
    const nestTarget = `${NESTJS_URL}/echo`;
    await Promise.all([
      fetch(expressTarget, { method: "POST", headers, body }).then((r) => console.info(`  → ${expressTarget} ${r.status}`)),
      fetch(nestTarget, { method: "POST", headers, body }).then((r) => console.info(`  → ${nestTarget} ${r.status}`)),
    ]);
    return { fanout: 2 };
  },
});

export default task;

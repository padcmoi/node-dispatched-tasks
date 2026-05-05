import { Injectable, OnApplicationBootstrap } from "@nestjs/common";

@Injectable()
export class EmitterService implements OnApplicationBootstrap {
  async onApplicationBootstrap() {
    void this.emitInitialTask();
  }

  private async emitInitialTask() {
    const ownerUrl = process.env.OWNER_URL ?? "http://nestjs-tasks-owner:3000";
    const url = `${ownerUrl}/tasks`;
    const body = {
      code: "ECHO_FROM_NESTJS",
      payload: { sender: "nestjs-emitter" },
      correlationId: `boot-${Date.now()}`,
    };
    for (let attempt = 1; attempt <= 60; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 202 || res.status === 200) {
          const json = (await res.json().catch(() => ({}))) as { publicId?: string };
          console.info(`[nestjs-emitter] enqueued task on owner publicId=${json.publicId ?? "?"}`);
          return;
        }
        console.warn(`[nestjs-emitter] unexpected status ${res.status}, retrying...`);
      } catch (err) {
        console.warn(`[nestjs-emitter] owner not reachable (attempt ${attempt})`, err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.error("[nestjs-emitter] gave up reaching the owner.");
  }
}

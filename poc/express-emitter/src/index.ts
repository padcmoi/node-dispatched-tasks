import express from "express";

const PORT = Number(process.env.PORT ?? 3000);
const OWNER_URL = process.env.OWNER_URL ?? "http://nestjs-tasks-owner:3000";

const app = express();
app.use(express.json());

app.post("/echo", (req, res) => {
  console.info("[express-emitter] received /echo", req.body);
  res.status(200).json({ ok: true, route: "echo" });
});

app.post("/from-nestjs", (req, res) => {
  console.info("[express-emitter] received /from-nestjs", req.body);
  res.status(200).json({ ok: true, route: "from-nestjs" });
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  console.info(`[express-emitter] listening on :${PORT}`);
  void emitInitialTask();
});

async function emitInitialTask() {
  const url = `${OWNER_URL}/tasks`;
  const body = {
    code: "ECHO_FROM_EXPRESS",
    payload: { sender: "express-emitter" },
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
        console.info(`[express-emitter] enqueued task on owner publicId=${json.publicId ?? "?"}`);
        return;
      }
      console.warn(`[express-emitter] unexpected status ${res.status}, retrying...`);
    } catch (err) {
      console.warn(`[express-emitter] owner not reachable (attempt ${attempt})`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error("[express-emitter] gave up reaching the owner.");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.info(`[express-emitter] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}

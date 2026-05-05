import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTask } from "../src/core/define-task.js";
import { DispatchedTaskService } from "../src/core/dispatched-task.service.js";
import { TaskValidationError } from "../src/core/errors.js";
import { InMemoryPriorityIndex } from "./fixtures/in-memory-priority-index.js";
import { InMemoryTaskStore } from "./fixtures/in-memory-store.js";

function makeService(opts: { schedulerEnabled?: boolean } = {}) {
  const store = new InMemoryTaskStore();
  const priority = new InMemoryPriorityIndex();
  const service = new DispatchedTaskService({
    store,
    priority,
    workerId: "test-worker",
    scheduler: { enabled: opts.schedulerEnabled ?? false },
  });
  return { store, priority, service };
}

describe("DispatchedTaskService.enqueue", () => {
  it("creates a record and pushes to ready queue when no scheduledAt", async () => {
    const { service, priority } = makeService();
    service.register(defineTask({ code: "DEMO", run: () => "ok" }));

    const record = await service.enqueue({ code: "DEMO", payload: { foo: "bar" } });

    expect(record.code).toBe("DEMO");
    expect(record.status).toBe("pending");
    expect(record.publicId).toHaveLength(26);
    expect(await priority.countReady()).toBe(1);
    expect(await priority.countDelayed()).toBe(0);
  });

  it("pushes to delayed queue when scheduledAt is in the future", async () => {
    const { service, priority } = makeService();
    service.register(defineTask({ code: "LATER", run: () => undefined }));

    await service.enqueue({
      code: "LATER",
      scheduledAt: new Date(Date.now() + 60_000),
    });

    expect(await priority.countReady()).toBe(0);
    expect(await priority.countDelayed()).toBe(1);
  });

  it("validates payload via inputSchema and throws on bad input", async () => {
    const { service } = makeService();
    service.register(
      defineTask({
        code: "VALIDATED",
        inputSchema: z.object({ name: z.string() }),
        run: () => undefined,
      })
    );

    await expect(service.enqueue({ code: "VALIDATED", payload: { name: 42 } })).rejects.toThrow(TaskValidationError);
  });

  it("dedupes on idempotencyKey: second enqueue returns the same task", async () => {
    const { service, priority } = makeService();
    service.register(defineTask({ code: "IDEM", run: () => undefined }));

    const a = await service.enqueue({ code: "IDEM", idempotencyKey: "abc" });
    const b = await service.enqueue({ code: "IDEM", idempotencyKey: "abc" });

    expect(b.publicId).toBe(a.publicId);
    expect(await priority.countReady()).toBe(1);
  });

  it("uses handler weight when not overridden", async () => {
    const { service } = makeService();
    service.register(defineTask({ code: "HEAVY", weight: 25, run: () => undefined }));

    const r = await service.enqueue({ code: "HEAVY" });
    expect(r.weight).toBe(25);
  });

  it("respects explicit weight override", async () => {
    const { service } = makeService();
    service.register(defineTask({ code: "OVERRIDE", weight: 5, run: () => undefined }));

    const r = await service.enqueue({ code: "OVERRIDE", weight: 99 });
    expect(r.weight).toBe(99);
  });
});

describe("DispatchedTaskService scheduler runs registered handlers", () => {
  it("executes a task that succeeds", async () => {
    const { service, store } = makeService({ schedulerEnabled: true });
    const handler = vi.fn().mockResolvedValue("done");
    service.register(defineTask({ code: "RUN_OK", run: handler }));

    const enq = await service.enqueue({ code: "RUN_OK", payload: { x: 1 } });
    await service.start();
    await waitUntil(async () => {
      const r = await store.getByPublicId(enq.publicId);
      return r?.status === "succeeded";
    });
    await service.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    const final = await store.getByPublicId(enq.publicId);
    expect(final?.status).toBe("succeeded");
    expect(final?.result).toBe("done");
  });

  it("retries on failure then marks dead after maxAttempts", async () => {
    const { service, store } = makeService({ schedulerEnabled: true });
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    service.register(
      defineTask({
        code: "RUN_FAIL",
        maxAttempts: 2,
        backoff: { kind: "fixed", ms: 1 },
        run: handler,
      })
    );

    const enq = await service.enqueue({ code: "RUN_FAIL" });
    await service.start();
    await waitUntil(async () => {
      const r = await store.getByPublicId(enq.publicId);
      return r?.status === "dead";
    });
    await service.stop();

    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    const final = await store.getByPublicId(enq.publicId);
    expect(final?.status).toBe("dead");
    expect(final?.lastError).toContain("boom");
  });

  it("marks dead when handler is not registered", async () => {
    const { service, store } = makeService({ schedulerEnabled: true });
    const enq = await service.enqueue({ code: "UNKNOWN" });
    await service.start();
    await waitUntil(async () => {
      const r = await store.getByPublicId(enq.publicId);
      return r?.status === "dead";
    });
    await service.stop();

    const final = await store.getByPublicId(enq.publicId);
    expect(final?.status).toBe("dead");
    expect(final?.lastError).toMatch(/No handler/);
  });
});

describe("DispatchedTaskService admin ops", () => {
  it("cancel flips a pending task to cancelled and removes from ready queue", async () => {
    const { service, priority } = makeService();
    service.register(defineTask({ code: "C", run: () => undefined }));
    const r = await service.enqueue({ code: "C" });
    const cancelled = await service.cancel(r.publicId);
    expect(cancelled?.status).toBe("cancelled");
    expect(await priority.countReady()).toBe(0);
  });

  it("retry resets a dead task and re-pushes to ready queue", async () => {
    const { service, store, priority } = makeService();
    service.register(defineTask({ code: "R", run: () => undefined }));
    const r = await service.enqueue({ code: "R" });
    await store.markFailed(r.publicId, "boom", false);
    const retried = await service.retry(r.publicId);
    expect(retried?.status).toBe("pending");
    expect(await priority.countReady()).toBe(2);
  });

  it("list filters by code and status", async () => {
    const { service } = makeService();
    service.register(defineTask({ code: "L1", run: () => undefined }));
    service.register(defineTask({ code: "L2", run: () => undefined }));
    await service.enqueue({ code: "L1" });
    await service.enqueue({ code: "L2" });

    const onlyL1 = await service.list({ code: "L1" });
    expect(onlyL1).toHaveLength(1);
    expect(onlyL1[0].code).toBe("L1");
  });
});

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000, stepMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error("waitUntil: timed out");
}

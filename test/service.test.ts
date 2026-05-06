import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { DelayedTaskService, HandlerNotFoundError, defineTask, type TaskRecord } from "../src/index.js";

const createRedis = () => new RedisMock();

const noop = () => undefined;

describe("DelayedTaskService — constructor validation", () => {
  it("throws when redis is missing", () => {
    expect(
      () =>
        new DelayedTaskService({
          redis: undefined as unknown as Redis,
          namespace: "x",
        })
    ).toThrow(/redis/);
  });

  it("throws when namespace is missing or empty", () => {
    const redis = createRedis();
    expect(() => new DelayedTaskService({ redis, namespace: "" })).toThrow(/namespace/);
    expect(() => new DelayedTaskService({ redis, namespace: "   " })).toThrow(/namespace/);
  });

  it("throws when maxWeight is not a positive number", () => {
    const redis = createRedis();
    expect(() => new DelayedTaskService({ redis, namespace: "x", maxWeight: 0 })).toThrow(/maxWeight/);
    expect(() => new DelayedTaskService({ redis, namespace: "x", maxWeight: -1 })).toThrow(/maxWeight/);
    expect(() => new DelayedTaskService({ redis, namespace: "x", maxWeight: Number.NaN })).toThrow(/maxWeight/);
  });

  it("throws when pollIntervalMs is not a positive number", () => {
    const redis = createRedis();
    expect(() => new DelayedTaskService({ redis, namespace: "x", pollIntervalMs: 0 })).toThrow(/pollIntervalMs/);
    expect(() => new DelayedTaskService({ redis, namespace: "x", pollIntervalMs: -1 })).toThrow(/pollIntervalMs/);
  });
});

describe("DelayedTaskService — registry & has()", () => {
  it("rejects enqueue for an unknown task name", async () => {
    const service = new DelayedTaskService({ redis: createRedis(), namespace: "t1" });
    await expect(service.enqueue({ name: "MISSING" })).rejects.toBeInstanceOf(HandlerNotFoundError);
  });

  it("has() reflects registered tasks", () => {
    const service = new DelayedTaskService({ redis: createRedis(), namespace: "t2" });
    expect(service.has("HELLO")).toBe(false);
    service.register(defineTask({ name: "HELLO", run: noop }));
    expect(service.has("HELLO")).toBe(true);
  });
});

describe("DelayedTaskService — enqueue and scheduledAt", () => {
  const NOW = new Date("2026-05-05T18:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (namespace: string) => {
    const service = new DelayedTaskService({ redis: createRedis(), namespace });
    service.register(defineTask({ name: "HELLO", run: noop }));
    service.register(defineTask({ name: "HEAVY", weight: 3, run: noop }));
    return service;
  };

  it("defaults scheduledAt to now when omitted", async () => {
    const service = setup("e1");
    const record = await service.enqueue({ name: "HELLO" });
    expect(record.scheduledAtMs).toBe(NOW);
  });

  it("accepts a number as seconds from now", async () => {
    const service = setup("e2");
    const record = await service.enqueue({ name: "HELLO", scheduledAt: 10 });
    expect(record.scheduledAtMs).toBe(NOW + 10_000);
  });

  it("accepts a string of digits as seconds from now", async () => {
    const service = setup("e3");
    const record = await service.enqueue({ name: "HELLO", scheduledAt: "10" });
    expect(record.scheduledAtMs).toBe(NOW + 10_000);
  });

  it("accepts a Date as absolute", async () => {
    const service = setup("e4");
    const target = new Date("2027-01-01T00:00:00Z");
    const record = await service.enqueue({ name: "HELLO", scheduledAt: target });
    expect(record.scheduledAtMs).toBe(target.getTime());
  });

  it("accepts an ISO string as absolute", async () => {
    const service = setup("e5");
    const iso = "2027-01-01T00:00:00Z";
    const record = await service.enqueue({ name: "HELLO", scheduledAt: iso });
    expect(record.scheduledAtMs).toBe(Date.parse(iso));
  });

  it("rejects an invalid scheduledAt string", async () => {
    const service = setup("e6");
    await expect(service.enqueue({ name: "HELLO", scheduledAt: "+10s" })).rejects.toThrow(/invalid value/);
    await expect(service.enqueue({ name: "HELLO", scheduledAt: "not-a-date" })).rejects.toThrow(/invalid value/);
  });

  it("uses the definition weight when input weight is omitted", async () => {
    const service = setup("e7");
    const record = await service.enqueue({ name: "HEAVY" });
    expect(record.weight).toBe(3);
  });

  it("input weight overrides definition weight", async () => {
    const service = setup("e8");
    const record = await service.enqueue({ name: "HEAVY", weight: 1 });
    expect(record.weight).toBe(1);
  });

  it("rejects a non-positive weight", async () => {
    const service = setup("e9");
    await expect(service.enqueue({ name: "HELLO", weight: 0 })).rejects.toThrow(/weight/);
    await expect(service.enqueue({ name: "HELLO", weight: -1 })).rejects.toThrow(/weight/);
  });

  it("clamps weight to maxWeight when enqueue exceeds it", async () => {
    const service = new DelayedTaskService({ redis: createRedis(), namespace: "e-clamp", maxWeight: 5 });
    service.register(defineTask({ name: "HELLO", run: noop }));
    const a = await service.enqueue({ name: "HELLO", weight: 8 });
    const b = await service.enqueue({ name: "HELLO", weight: 5 });
    const c = await service.enqueue({ name: "HELLO", weight: 3 });
    expect(a.weight).toBe(5);
    expect(b.weight).toBe(5);
    expect(c.weight).toBe(3);
  });

  it("auto-increments task IDs", async () => {
    const service = setup("e10");
    const a = await service.enqueue({ name: "HELLO" });
    const b = await service.enqueue({ name: "HELLO" });
    const c = await service.enqueue({ name: "HELLO" });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(c.id).toBe(3);
  });
});

describe("DelayedTaskService — list and get", () => {
  const setup = (namespace: string) => {
    const service = new DelayedTaskService({ redis: createRedis(), namespace });
    service.register(defineTask({ name: "HELLO", run: noop }));
    return service;
  };

  it("get() returns null for an unknown id", async () => {
    const service = setup("g1");
    expect(await service.get(999)).toBeNull();
  });

  it("get() returns the record from any bucket", async () => {
    const service = setup("g2");
    const record = await service.enqueue({ name: "HELLO" });
    const got = await service.get(record.id);
    expect(got?.id).toBe(record.id);
  });

  it("list.pending() returns enqueued tasks sorted by id", async () => {
    const service = setup("g3");
    await service.enqueue({ name: "HELLO" });
    await service.enqueue({ name: "HELLO" });
    await service.enqueue({ name: "HELLO" });
    const pending = await service.list.pending();
    expect(pending.map((t: TaskRecord) => t.id)).toEqual([1, 2, 3]);
  });

  it("list.finished(), list.failed() and list.canceled() are empty initially", async () => {
    const service = setup("g4");
    expect(await service.list.finished()).toEqual([]);
    expect(await service.list.failed()).toEqual([]);
    expect(await service.list.canceled()).toEqual([]);
  });
});

describe("DelayedTaskService — setWeight", () => {
  const setup = (namespace: string, maxWeight = 5) => {
    const service = new DelayedTaskService({ redis: createRedis(), namespace, maxWeight });
    service.register(defineTask({ name: "HELLO", run: noop }));
    return service;
  };

  it("updates the weight of a pending task", async () => {
    const service = setup("sw1", 10);
    const record = await service.enqueue({ name: "HELLO", weight: 2 });
    const updated = await service.setWeight(record.id, 7);
    expect(updated?.weight).toBe(7);
    expect((await service.list.pending()).map((t) => t.weight)).toEqual([7]);
  });

  it("clamps the new weight to maxWeight", async () => {
    const service = setup("sw2", 5);
    const record = await service.enqueue({ name: "HELLO", weight: 1 });
    const updated = await service.setWeight(record.id, 9);
    expect(updated?.weight).toBe(5);
  });

  it("returns null for an unknown id", async () => {
    const service = setup("sw3");
    expect(await service.setWeight(999, 2)).toBeNull();
  });

  it("rejects a non-positive weight", async () => {
    const service = setup("sw4");
    await expect(service.setWeight(1, 0)).rejects.toThrow(/weight/);
    await expect(service.setWeight(1, -1)).rejects.toThrow(/weight/);
  });

  it("does not change weight of tasks in FINISH/FAILED/CANCELED buckets", async () => {
    const service = setup("sw5", 10);
    const record = await service.enqueue({ name: "HELLO" });
    await service.cancel(record.id);
    expect(await service.setWeight(record.id, 9)).toBeNull();
  });
});

describe("DelayedTaskService — cancel and replay", () => {
  const setup = (namespace: string) => {
    const service = new DelayedTaskService({ redis: createRedis(), namespace });
    service.register(defineTask({ name: "HELLO", run: noop }));
    return service;
  };

  it("cancel() moves a pending task to CANCELED", async () => {
    const service = setup("c1");
    const record = await service.enqueue({ name: "HELLO" });
    const canceled = await service.cancel(record.id);
    expect(canceled?.status).toBe("canceled");
    expect(canceled?.canceledAt).toBeTruthy();

    expect(await service.list.pending()).toEqual([]);
    const list = await service.list.canceled();
    expect(list.map((t) => t.id)).toEqual([record.id]);
  });

  it("cancel() returns null for unknown id", async () => {
    const service = setup("c2");
    expect(await service.cancel(999)).toBeNull();
  });

  it("replay() returns null for unknown id", async () => {
    const service = setup("r1");
    expect(await service.replay(999)).toBeNull();
  });

  it("replay() preserves the original scheduledAt when no override is given", async () => {
    const service = setup("r2");
    const future = new Date("2027-01-01T00:00:00Z");
    const record = await service.enqueue({ name: "HELLO", scheduledAt: future });
    await service.cancel(record.id);
    const replayed = await service.replay(record.id);
    expect(replayed?.scheduledAtMs).toBe(future.getTime());
    expect(replayed?.status).toBe("pending");
    expect(replayed?.canceledAt).toBeNull();
  });

  it("replay() applies a new scheduledAt (number = seconds from now)", async () => {
    vi.useFakeTimers();
    const NOW = new Date("2026-05-05T18:00:00.000Z").getTime();
    vi.setSystemTime(NOW);
    try {
      const service = setup("r3");
      const record = await service.enqueue({ name: "HELLO" });
      await service.cancel(record.id);
      const replayed = await service.replay(record.id, { scheduledAt: 60 });
      expect(replayed?.scheduledAtMs).toBe(NOW + 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replay() applies an ISO string scheduledAt", async () => {
    const service = setup("r4");
    const record = await service.enqueue({ name: "HELLO" });
    await service.cancel(record.id);
    const iso = "2027-06-15T10:00:00Z";
    const replayed = await service.replay(record.id, { scheduledAt: iso });
    expect(replayed?.scheduledAtMs).toBe(Date.parse(iso));
  });

  it("replay() returns null when the task is in PENDING (not canceled or failed)", async () => {
    const service = setup("r5");
    const record = await service.enqueue({ name: "HELLO" });
    expect(await service.replay(record.id)).toBeNull();
  });

  it("replay() also moves a FAILED task back to PENDING", async () => {
    const service = setup("r6");
    const record = await service.enqueue({ name: "HELLO" });
    // Simulate a failed run by moving the record to the FAILED bucket directly via the underlying store.
    const failedRecord: typeof record = {
      ...record,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "boom",
    };
    const store = (service as unknown as { store: { move: (from: string, to: string, r: typeof record) => Promise<void> } })
      .store;
    await store.move("PENDING", "FAILED", failedRecord);

    const replayed = await service.replay(record.id, { scheduledAt: 30 });
    expect(replayed?.status).toBe("pending");
    expect(replayed?.error).toBeNull();
    expect(await service.list.failed()).toEqual([]);
    expect((await service.list.pending()).map((t) => t.id)).toEqual([record.id]);
  });

  it("cancel() returns null for a non-pending status (e.g. already canceled)", async () => {
    const service = setup("c3");
    const record = await service.enqueue({ name: "HELLO" });
    await service.cancel(record.id);
    expect(await service.cancel(record.id)).toBeNull();
  });
});

describe("DelayedTaskService — scheduler runtime", () => {
  const NOW = new Date("2026-05-05T18:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("respects maxWeight: task 2 waits while task 1 (3+3 > 5) is running, then starts when capacity frees up", async () => {
    const service = new DelayedTaskService({
      redis: createRedis(),
      namespace: "sched-cap",
      maxWeight: 5,
      pollIntervalMs: 1000,
    });

    // A handler that we resolve manually so we can hold task 1 "running" while we observe task 2.
    const resolves: ((value: unknown) => void)[] = [];
    service.register(
      defineTask({
        name: "HEAVY",
        weight: 3,
        run: () =>
          new Promise<unknown>((resolve) => {
            resolves.push(resolve);
          }),
      })
    );

    // Two tasks, both scheduled 10 seconds from now, weight 3 each.
    const t1 = await service.enqueue({ name: "HEAVY", scheduledAt: 10 });
    const t2 = await service.enqueue({ name: "HEAVY", scheduledAt: 10 });
    expect(t1.id).toBe(1);
    expect(t2.id).toBe(2);

    service.start();

    // Advance to T+11s — both tasks are due, but only task 1 fits the weight cap (3 ≤ 5; 3+3 > 5).
    await vi.advanceTimersByTimeAsync(11_000);

    {
      const pending = await service.list.pending();
      const r1 = pending.find((r) => r.id === t1.id);
      const r2 = pending.find((r) => r.id === t2.id);
      expect(r1?.status).toBe("running");
      expect(r2?.status).toBe("pending");
      expect(await service.list.finished()).toEqual([]);
    }

    // Tick again before task 1 resolves — task 2 must still be held back.
    await vi.advanceTimersByTimeAsync(1_000);
    {
      const pending = await service.list.pending();
      expect(pending.find((r) => r.id === t2.id)?.status).toBe("pending");
    }

    // Resolve task 1 → it moves to FINISH and frees its weight.
    resolves[0]({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);

    {
      const finished = await service.list.finished();
      expect(finished.map((r) => r.id)).toEqual([t1.id]);
      const pending = await service.list.pending();
      const r2 = pending.find((r) => r.id === t2.id);
      expect(r2?.status).toBe("running");
    }

    // Resolve task 2 → it also moves to FINISH.
    resolves[1]({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);

    {
      const finished = await service.list.finished();
      expect(finished.map((r) => r.id)).toEqual([t1.id, t2.id]);
      expect(await service.list.pending()).toEqual([]);
    }

    await service.stop();
  });

  it("does not start any task before scheduledAt is due", async () => {
    const service = new DelayedTaskService({
      redis: createRedis(),
      namespace: "sched-future",
      maxWeight: 10,
      pollIntervalMs: 1000,
    });
    const ran: number[] = [];
    service.register(
      defineTask({
        name: "JOB",
        run: (_data, ctx) => {
          ran.push(ctx.id);
        },
      })
    );

    await service.enqueue({ name: "JOB", scheduledAt: 30 });
    service.start();

    // Tick several times before due — handler must not run.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ran).toEqual([]);
    expect((await service.list.pending()).map((r) => r.status)).toEqual(["pending"]);

    // Cross the deadline — handler runs.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(ran).toEqual([1]);
    expect((await service.list.finished()).map((r) => r.id)).toEqual([1]);

    await service.stop();
  });

  it("moves a task to FAILED when its handler throws", async () => {
    const service = new DelayedTaskService({
      redis: createRedis(),
      namespace: "sched-fail",
      pollIntervalMs: 1000,
    });
    service.register(
      defineTask({
        name: "BOOM",
        run: () => {
          throw new Error("kaboom");
        },
      })
    );
    const record = await service.enqueue({ name: "BOOM" });
    service.start();

    await vi.advanceTimersByTimeAsync(1_500);

    const failed = await service.list.failed();
    expect(failed.map((r) => r.id)).toEqual([record.id]);
    expect(failed[0]?.status).toBe("failed");
    expect(failed[0]?.error).toMatch(/kaboom/);
    expect(await service.list.finished()).toEqual([]);

    await service.stop();
  });
});

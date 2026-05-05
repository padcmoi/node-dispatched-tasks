import { describe, expect, it } from "vitest";
import { defineTask, isTaskDefinition } from "../src/core/define-task.js";

describe("defineTask", () => {
  it("applies sane defaults", () => {
    const t = defineTask({
      code: "TEST",
      run: () => undefined,
    });
    expect(t.code).toBe("TEST");
    expect(t.weight).toBe(1);
    expect(t.maxAttempts).toBe(3);
    expect(t.timeoutMs).toBe(30_000);
    expect(t.backoff.kind).toBe("exp");
  });

  it("preserves user-supplied options", () => {
    const t = defineTask({
      code: "X",
      run: () => undefined,
      weight: 50,
      maxAttempts: 5,
      timeoutMs: 1000,
      backoff: { kind: "fixed", ms: 250 },
    });
    expect(t.weight).toBe(50);
    expect(t.maxAttempts).toBe(5);
    expect(t.timeoutMs).toBe(1000);
    expect(t.backoff).toEqual({ kind: "fixed", ms: 250 });
  });

  it("throws on empty code", () => {
    expect(() => defineTask({ code: "", run: () => undefined })).toThrow();
  });

  it("isTaskDefinition recognises shape", () => {
    const t = defineTask({ code: "Y", run: () => undefined });
    expect(isTaskDefinition(t)).toBe(true);
    expect(isTaskDefinition({})).toBe(false);
    expect(isTaskDefinition(null)).toBe(false);
  });
});

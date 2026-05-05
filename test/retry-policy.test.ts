import { describe, expect, it } from "vitest";
import { computeBackoffMs } from "../src/core/retry-policy.js";

describe("computeBackoffMs", () => {
  it("fixed always returns the same value", () => {
    const s = { kind: "fixed" as const, ms: 5000 };
    expect(computeBackoffMs(s, 1)).toBe(5000);
    expect(computeBackoffMs(s, 4)).toBe(5000);
  });

  it("linear scales with attempt", () => {
    const s = { kind: "linear" as const, stepMs: 1000 };
    expect(computeBackoffMs(s, 1)).toBe(1000);
    expect(computeBackoffMs(s, 3)).toBe(3000);
  });

  it("linear caps at maxMs", () => {
    const s = { kind: "linear" as const, stepMs: 1000, maxMs: 2500 };
    expect(computeBackoffMs(s, 5)).toBe(2500);
  });

  it("exp doubles each attempt", () => {
    const s = { kind: "exp" as const, baseMs: 1000 };
    expect(computeBackoffMs(s, 1)).toBe(1000);
    expect(computeBackoffMs(s, 2)).toBe(2000);
    expect(computeBackoffMs(s, 3)).toBe(4000);
  });

  it("exp caps at maxMs", () => {
    const s = { kind: "exp" as const, baseMs: 1000, maxMs: 4000 };
    expect(computeBackoffMs(s, 6)).toBe(4000);
  });

  it("fn delegates to compute", () => {
    const s = { kind: "fn" as const, compute: (n: number) => n * 100 };
    expect(computeBackoffMs(s, 7)).toBe(700);
  });

  it("rejects attempts < 1 by clamping", () => {
    const s = { kind: "linear" as const, stepMs: 500 };
    expect(computeBackoffMs(s, 0)).toBe(500);
    expect(computeBackoffMs(s, -3)).toBe(500);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveScheduledAt } from "../src/index.js";

describe("resolveScheduledAt", () => {
  const NOW = new Date("2026-05-05T18:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Date.now() when value is undefined", () => {
    expect(resolveScheduledAt(undefined)).toBe(NOW);
  });

  it("returns the timestamp of an absolute Date", () => {
    const date = new Date("2027-01-01T00:00:00Z");
    expect(resolveScheduledAt(date)).toBe(date.getTime());
  });

  it("treats a positive number as seconds from now", () => {
    expect(resolveScheduledAt(10)).toBe(NOW + 10_000);
    expect(resolveScheduledAt(0)).toBe(NOW);
    expect(resolveScheduledAt(3600)).toBe(NOW + 3_600_000);
  });

  it("treats a negative number as seconds in the past", () => {
    expect(resolveScheduledAt(-30)).toBe(NOW - 30_000);
  });

  it("treats a fractional number as fractional seconds from now", () => {
    expect(resolveScheduledAt(1.5)).toBe(NOW + 1500);
  });

  it("treats a numeric string as seconds from now", () => {
    expect(resolveScheduledAt("10")).toBe(NOW + 10_000);
    expect(resolveScheduledAt("0")).toBe(NOW);
  });

  it("trims whitespace around numeric strings", () => {
    expect(resolveScheduledAt("  10  ")).toBe(NOW + 10_000);
  });

  it("parses a string ISO date", () => {
    const iso = "2026-12-31T23:59:00.000Z";
    expect(resolveScheduledAt(iso)).toBe(Date.parse(iso));
  });

  it("parses an ISO date without explicit ms", () => {
    const iso = "2026-12-31T23:59:00Z";
    expect(resolveScheduledAt(iso)).toBe(Date.parse(iso));
  });

  it("throws on an invalid Date instance", () => {
    expect(() => resolveScheduledAt(new Date("not-a-date"))).toThrow(/invalid Date/);
  });

  it("throws on NaN number", () => {
    expect(() => resolveScheduledAt(Number.NaN)).toThrow(/invalid number/);
  });

  it("throws on Infinity", () => {
    expect(() => resolveScheduledAt(Number.POSITIVE_INFINITY)).toThrow(/invalid number/);
    expect(() => resolveScheduledAt(Number.NEGATIVE_INFINITY)).toThrow(/invalid number/);
  });

  it("throws on an empty string", () => {
    expect(() => resolveScheduledAt("")).toThrow(/empty/);
    expect(() => resolveScheduledAt("   ")).toThrow(/empty/);
  });

  it("throws on a non-parsable string", () => {
    expect(() => resolveScheduledAt("not-a-date")).toThrow(/invalid value/);
    expect(() => resolveScheduledAt("+10s")).toThrow(/invalid value/);
  });

  it("throws on an unsupported type", () => {
    expect(() => resolveScheduledAt(true as unknown as number)).toThrow();
    expect(() => resolveScheduledAt(null as unknown as number)).toThrow();
  });
});

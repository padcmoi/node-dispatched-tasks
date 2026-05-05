import { describe, expect, it } from "vitest";
import { isUlid, ulid } from "../src/core/ulid.js";

describe("ulid", () => {
  it("generates a 26-char string", () => {
    const value = ulid();
    expect(value).toHaveLength(26);
    expect(isUlid(value)).toBe(true);
  });

  it("encodes the time prefix monotonically with input timestamp", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isUlid("not-a-ulid")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAVI")).toBe(false);
  });

  it("produces uniqueness across rapid calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(ulid());
    expect(set.size).toBe(1000);
  });
});

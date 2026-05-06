import { describe, expect, it } from "vitest";
import { defineTask } from "../src/index.js";

describe("defineTask", () => {
  it("returns the input definition unchanged", () => {
    const definition = defineTask({
      name: "HELLO",
      weight: 2,
      timeoutMs: 1000,
      run: () => "ok",
    });
    expect(definition.name).toBe("HELLO");
    expect(definition.weight).toBe(2);
    expect(definition.timeoutMs).toBe(1000);
  });

  it("rejects a missing name", () => {
    expect(() => defineTask({ name: "", run: () => undefined })).toThrow();
  });

  it("rejects a non-function run", () => {
    expect(() => defineTask({ name: "HELLO", run: undefined as unknown as () => void })).toThrow();
  });
});

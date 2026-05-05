import { describe, expect, it } from "vitest";
import { defineTask, HandlerNotFoundError } from "../src/index.js";
import { TaskRegistry } from "../src/task-registry.js";

describe("TaskRegistry", () => {
  it("registers and looks up a task", () => {
    const registry = new TaskRegistry();
    const definition = defineTask({ name: "HELLO", run: () => "ok" });
    registry.register(definition);
    expect(registry.has("HELLO")).toBe(true);
    expect(registry.get("HELLO")).toBe(definition);
  });

  it("throws when the handler is missing", () => {
    const registry = new TaskRegistry();
    expect(() => registry.get("MISSING")).toThrow(HandlerNotFoundError);
  });

  it("rejects unnamed definitions", () => {
    const registry = new TaskRegistry();
    expect(() => registry.register({ name: "  ", run: () => undefined })).toThrow();
  });
});

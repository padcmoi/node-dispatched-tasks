import { describe, expect, it } from "vitest";
import { defineTask } from "../src/core/define-task.js";
import { TaskRegistry } from "../src/core/task-registry.js";
import { HandlerNotFoundError } from "../src/core/errors.js";

describe("TaskRegistry", () => {
  it("registers and retrieves a handler", () => {
    const reg = new TaskRegistry();
    const t = defineTask({ code: "A", run: () => undefined });
    reg.register(t);
    expect(reg.has("A")).toBe(true);
    expect(reg.get("A")).toBe(t);
  });

  it("throws on duplicate registration", () => {
    const reg = new TaskRegistry();
    reg.register(defineTask({ code: "B", run: () => undefined }));
    expect(() => reg.register(defineTask({ code: "B", run: () => undefined }))).toThrow();
  });

  it("get throws HandlerNotFoundError when missing", () => {
    const reg = new TaskRegistry();
    expect(() => reg.get("MISSING")).toThrow(HandlerNotFoundError);
  });

  it("tryGet returns null when missing", () => {
    const reg = new TaskRegistry();
    expect(reg.tryGet("MISSING")).toBeNull();
  });
});

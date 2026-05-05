import type { TaskDefinition } from "./types.js";

export function defineTask<P = unknown, R = unknown>(input: TaskDefinition<P, R>) {
  if (typeof input.name !== "string" || input.name.trim() === "") {
    throw new Error("defineTask: 'name' is required and cannot be empty");
  }
  if (typeof input.run !== "function") {
    throw new Error("defineTask: 'run' must be a function");
  }
  return input;
}

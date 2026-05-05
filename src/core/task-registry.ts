import { HandlerNotFoundError } from "./errors.js";
import type { TaskDefinition } from "./types.js";

export class TaskRegistry {
  private readonly handlers = new Map<string, TaskDefinition>();

  register<TPayload, TResult>(definition: TaskDefinition<TPayload, TResult>) {
    if (typeof definition.code !== "string" || definition.code.trim() === "") {
      throw new Error("TaskRegistry.register: task definition must have a non-empty 'code'.");
    }
    if (this.handlers.has(definition.code)) {
      throw new Error(`TaskRegistry.register: duplicate task code '${definition.code}'.`);
    }
    this.handlers.set(definition.code, definition as unknown as TaskDefinition);
  }

  has(code: string) {
    return this.handlers.has(code);
  }

  get(code: string) {
    const found = this.handlers.get(code);
    if (!found) throw new HandlerNotFoundError(code);
    return found;
  }

  tryGet(code: string) {
    return this.handlers.get(code) ?? null;
  }

  list() {
    return Array.from(this.handlers.values());
  }

  clear() {
    this.handlers.clear();
  }
}

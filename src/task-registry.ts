import { HandlerNotFoundError } from "./errors.js";
import type { TaskDefinition } from "./types.js";

export class TaskRegistry {
  private readonly handlers = new Map<string, TaskDefinition>();

  register(definition: TaskDefinition) {
    if (typeof definition.name !== "string" || definition.name.trim() === "") {
      throw new Error("TaskRegistry: task definition must have a non-empty name");
    }
    this.handlers.set(definition.name, definition);
  }

  has(name: string) {
    return this.handlers.has(name);
  }

  get(name: string) {
    const def = this.handlers.get(name);
    if (!def) throw new HandlerNotFoundError(name);
    return def;
  }

  list() {
    return [...this.handlers.values()];
  }
}

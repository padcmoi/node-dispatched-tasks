export class DelayedTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class TaskNotFoundError extends DelayedTaskError {
  constructor(public readonly id: number) {
    super(`Task ${String(id)} not found.`);
  }
}

export class HandlerNotFoundError extends DelayedTaskError {
  constructor(public readonly taskName: string) {
    super(`No handler registered for task name "${taskName}".`);
  }
}

export class TaskValidationError extends DelayedTaskError {}

export class InvalidTaskStateError extends DelayedTaskError {}

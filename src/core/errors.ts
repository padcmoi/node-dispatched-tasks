export class DispatchedTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchedTaskError";
  }
}

export class TaskNotFoundError extends DispatchedTaskError {
  constructor(publicId: string) {
    super(`Task not found: ${publicId}`);
    this.name = "TaskNotFoundError";
  }
}

export class HandlerNotFoundError extends DispatchedTaskError {
  constructor(code: string) {
    super(`No handler registered for task code: ${code}`);
    this.name = "HandlerNotFoundError";
  }
}

export class TaskValidationError extends DispatchedTaskError {
  constructor(message: string) {
    super(`Task payload validation failed: ${message}`);
    this.name = "TaskValidationError";
  }
}

export class TaskTimeoutError extends DispatchedTaskError {
  constructor(publicId: string, timeoutMs: number) {
    super(`Task ${publicId} timed out after ${String(timeoutMs)}ms`);
    this.name = "TaskTimeoutError";
  }
}

export class IdempotencyConflictError extends DispatchedTaskError {
  constructor(key: string) {
    super(`Idempotency conflict for key: ${key}`);
    this.name = "IdempotencyConflictError";
  }
}

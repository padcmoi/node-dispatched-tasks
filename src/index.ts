// Public API barrel
export { DispatchedTaskService } from "./core/dispatched-task.service.js";
export type { DispatchedTaskServiceOptions, EnqueueInput, SchedulerConfig } from "./core/dispatched-task.service.js";

export { defineTask, isTaskDefinition } from "./core/define-task.js";
export type { DefineTaskInput } from "./core/define-task.js";

export { TaskRegistry } from "./core/task-registry.js";
export { Scheduler } from "./core/scheduler.js";
export type { SchedulerOptions } from "./core/scheduler.js";

export { computeBackoffMs, DEFAULT_BACKOFF } from "./core/retry-policy.js";

export { ulid, isUlid } from "./core/ulid.js";

export {
  DispatchedTaskError,
  HandlerNotFoundError,
  IdempotencyConflictError,
  TaskNotFoundError,
  TaskTimeoutError,
  TaskValidationError,
} from "./core/errors.js";

export type {
  BackoffExponential,
  BackoffFixed,
  BackoffFn,
  BackoffLinear,
  BackoffStrategy,
  Logger,
  NewTaskRecord,
  RunContext,
  SchemaLike,
  TaskDefinition,
  TaskListFilters,
  TaskRecord,
  TaskSource,
  TaskStatus,
} from "./core/types.js";
export { TASK_SOURCES, TASK_STATUSES } from "./core/types.js";

// Store (interface + adapters)
export type { TaskStore } from "./store/task-store.interface.js";
export { TypeOrmTaskStore } from "./store/adapters/typeorm-task-store.js";
export type { TypeOrmTaskStoreOptions } from "./store/adapters/typeorm-task-store.js";
export {
  DispatchedTask,
  configureDispatchedTask,
  getConfiguredDispatchedTaskTableName,
} from "./store/adapters/dispatched-task.entity.js";
export type { DispatchedTaskConfig } from "./store/adapters/dispatched-task.entity.js";

// Priority (interface + adapters)
export type { PriorityIndex, ReadyClaim } from "./priority/priority-index.interface.js";
export { RedisPriorityIndex } from "./priority/adapters/redis-priority-index.js";
export type { RedisPriorityIndexOptions } from "./priority/adapters/redis-priority-index.js";

// Validation
export { validatePayload } from "./validation/zod-validate.js";

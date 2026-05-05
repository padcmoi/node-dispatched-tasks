import type { NewTaskRecord, TaskListFilters, TaskRecord } from "../core/types.js";

export interface TaskStore {
  insert: (input: NewTaskRecord) => Promise<TaskRecord>;
  getByPublicId: (publicId: string) => Promise<TaskRecord | null>;
  getByIdempotencyKey: (key: string) => Promise<TaskRecord | null>;
  claim: (publicId: string, claimedBy: string) => Promise<TaskRecord | null>;
  markStarted: (publicId: string) => Promise<void>;
  markSucceeded: (publicId: string, result: unknown) => Promise<void>;
  markFailed: (publicId: string, error: string, willRetry: boolean) => Promise<void>;
  resetForRetry: (publicId: string, scheduledAt: Date | null) => Promise<TaskRecord | null>;
  cancel: (publicId: string) => Promise<TaskRecord | null>;
  list: (filters: TaskListFilters) => Promise<TaskRecord[]>;
  pendingOrRunning: () => Promise<TaskRecord[]>;
}

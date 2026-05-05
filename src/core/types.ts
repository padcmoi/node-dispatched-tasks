export const TASK_STATUSES = ["pending", "claimed", "running", "succeeded", "failed", "dead", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_SOURCES = ["http", "amqp", "cron", "internal"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export type SchemaLike<T> = {
  safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues?: unknown; message?: string } };
};

export interface BackoffLinear {
  kind: "linear";
  stepMs: number;
  maxMs?: number;
}

export interface BackoffExponential {
  kind: "exp";
  baseMs: number;
  maxMs?: number;
}

export interface BackoffFixed {
  kind: "fixed";
  ms: number;
}

export interface BackoffFn {
  kind: "fn";
  compute: (attempt: number) => number;
}

export type BackoffStrategy = BackoffLinear | BackoffExponential | BackoffFixed | BackoffFn;

export interface RunContext {
  publicId: string;
  attempt: number;
  scheduledAt: Date | null;
  triggeredAt: Date;
  signal: AbortSignal;
}

export interface TaskDefinition<TPayload = unknown, TResult = unknown> {
  code: string;
  weight: number;
  maxAttempts: number;
  timeoutMs: number;
  backoff: BackoffStrategy;
  inputSchema?: SchemaLike<TPayload>;
  run: (payload: TPayload, ctx: RunContext) => Promise<TResult> | TResult;
}

export interface NewTaskRecord {
  publicId: string;
  code: string;
  payload: unknown;
  weight: number;
  maxAttempts: number;
  scheduledAt: Date | null;
  source: TaskSource;
  sourceMeta: Record<string, unknown> | null;
  callback: Record<string, unknown> | null;
  correlationId: string | null;
  idempotencyKey: string | null;
  priority: number | null;
}

export interface TaskRecord {
  id: string;
  publicId: string;
  code: string;
  payload: unknown;
  weight: number;
  status: TaskStatus;
  priority: number | null;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  source: TaskSource;
  sourceMeta: Record<string, unknown> | null;
  callback: Record<string, unknown> | null;
  result: unknown;
  correlationId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskListFilters {
  status?: TaskStatus | TaskStatus[];
  code?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
  fromCreatedAt?: Date;
  toCreatedAt?: Date;
}

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export type TaskStatus = "pending" | "running" | "finished" | "canceled" | "failed";

export interface TaskRecord {
  id: number;
  name: string;
  data: unknown;
  scheduledAt: string;
  scheduledAtMs: number;
  weight: number;
  status: TaskStatus;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
  result: unknown;
  error: string | null;
}

/**
 * Accepts:
 *   - `Date`         → absolute date.
 *   - `number`       → number of seconds from now.
 *   - `string`       → ISO date (e.g. `"2026-12-31T23:59:00Z"`) OR numeric seconds-from-now (e.g. `"10"`).
 *   - `undefined`    → run immediately (now).
 */
export type ScheduledAtInput = Date | number | string;

export interface EnqueueInput {
  name: string;
  data?: unknown;
  scheduledAt?: ScheduledAtInput;
  weight?: number;
}

/**
 * Options for the typed `enqueue(definition, options)` overload.
 * `P` is inferred from the `TaskDefinition` so `data` is constrained automatically.
 */
export interface TypedEnqueueOptions<P> {
  data?: P;
  scheduledAt?: ScheduledAtInput;
  weight?: number;
}

export interface ReplayOptions {
  scheduledAt?: ScheduledAtInput;
}

export interface RunContext {
  id: number;
  name: string;
  signal: AbortSignal;
}

export interface TaskDefinition<P = unknown, R = unknown> {
  name: string;
  weight?: number;
  timeoutMs?: number;
  run: (data: P, ctx: RunContext) => Promise<R> | R;
}

export interface Logger {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
  debug?: (message: string, meta?: unknown) => void;
}

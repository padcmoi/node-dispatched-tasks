import { DEFAULT_BACKOFF } from "./retry-policy.js";
import type { TaskDefinition, BackoffStrategy, RunContext, SchemaLike } from "./types.js";

export interface DefineTaskInput<TPayload, TResult> {
  code: string;
  run: (payload: TPayload, ctx: RunContext) => Promise<TResult> | TResult;
  weight?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  backoff?: BackoffStrategy;
  inputSchema?: SchemaLike<TPayload>;
}

const DEFAULT_WEIGHT = 1;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

export function defineTask<TPayload = unknown, TResult = unknown>(input: DefineTaskInput<TPayload, TResult>) {
  if (typeof input.code !== "string" || input.code.trim() === "") {
    throw new Error("defineTask: 'code' is required and must be a non-empty string.");
  }
  if (typeof input.run !== "function") {
    throw new Error("defineTask: 'run' must be a function.");
  }
  const definition: TaskDefinition<TPayload, TResult> = {
    code: input.code,
    run: input.run,
    weight: input.weight ?? DEFAULT_WEIGHT,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    backoff: input.backoff ?? DEFAULT_BACKOFF,
    inputSchema: input.inputSchema,
  };
  return definition;
}

// eslint-disable-next-line no-restricted-syntax
export function isTaskDefinition(value: unknown): value is TaskDefinition {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as { code?: unknown; run?: unknown; weight?: unknown };
  return typeof obj.code === "string" && typeof obj.run === "function" && typeof obj.weight === "number";
}

import type { BackoffStrategy } from "./types.js";

export function computeBackoffMs(strategy: BackoffStrategy, attempt: number) {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  switch (strategy.kind) {
    case "fixed":
      return Math.max(0, strategy.ms);
    case "linear": {
      const raw = strategy.stepMs * safeAttempt;
      return strategy.maxMs !== undefined ? Math.min(raw, strategy.maxMs) : raw;
    }
    case "exp": {
      const raw = strategy.baseMs * Math.pow(2, safeAttempt - 1);
      return strategy.maxMs !== undefined ? Math.min(raw, strategy.maxMs) : raw;
    }
    case "fn":
      return Math.max(0, strategy.compute(safeAttempt));
  }
}

export const DEFAULT_BACKOFF: BackoffStrategy = {
  kind: "exp",
  baseMs: 1_000,
  maxMs: 60_000,
};

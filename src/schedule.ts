import type { ScheduledAtInput } from "./types.js";

/**
 * Normalize a `scheduledAt` input into an absolute epoch (ms).
 *
 * Accepts:
 *   - `Date`      → absolute date.
 *   - `number`    → number of seconds from now (e.g. 10 → 10s in the future).
 *   - `string`    → ISO date or numeric seconds-from-now ("10").
 *   - `undefined` → now.
 *
 * Throws on invalid input.
 */
export function resolveScheduledAt(value: ScheduledAtInput | undefined) {
  if (value === undefined) return Date.now();
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new Error("scheduledAt: invalid Date");
    return ms;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("scheduledAt: invalid number");
    return Date.now() + value * 1000;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") throw new Error("scheduledAt: empty string");
    if (/^\d+$/.test(trimmed)) {
      return Date.now() + Number(trimmed) * 1000;
    }
    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) {
      throw new Error(`scheduledAt: invalid value '${value}' (expected a Date, a number of seconds, or an ISO date string)`);
    }
    return ms;
  }
  throw new Error("scheduledAt: must be a Date, a number of seconds, or an ISO date string");
}

import { TaskValidationError } from "../core/errors.js";
import type { SchemaLike } from "../core/types.js";

export function validatePayload<T>(schema: SchemaLike<T> | undefined, payload: unknown) {
  if (!schema) return payload as T;
  const result = schema.safeParse(payload);
  if (!result.success) {
    const message = result.error.message ?? JSON.stringify(result.error.issues);
    throw new TaskValidationError(message);
  }
  return result.data;
}

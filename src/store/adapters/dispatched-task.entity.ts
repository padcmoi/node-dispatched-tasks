import {
  Column,
  CreateDateColumn,
  Entity,
  getMetadataArgsStorage,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { TASK_SOURCES } from "../../core/types.js";
import type { TaskSource, TaskStatus } from "../../core/types.js";

const DEFAULT_TABLE_NAME = "dispatched_task";

@Entity(DEFAULT_TABLE_NAME)
@Index(`ix_${DEFAULT_TABLE_NAME}_status`, ["status"])
@Index(`ix_${DEFAULT_TABLE_NAME}_code`, ["code"])
@Index(`ix_${DEFAULT_TABLE_NAME}_created_at`, ["createdAt"])
@Index(`ix_${DEFAULT_TABLE_NAME}_correlation_id`, ["correlationId"])
@Index(`uq_${DEFAULT_TABLE_NAME}_public_id`, ["publicId"], { unique: true })
@Index(`uq_${DEFAULT_TABLE_NAME}_idempotency_key`, ["idempotencyKey"], {
  unique: true,
  where: "idempotency_key IS NOT NULL",
})
export class DispatchedTask {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ type: "char", length: 26, name: "public_id" })
  publicId!: string;

  @Column({ type: "varchar", length: 191 })
  code!: string;

  @Column({ type: "json", nullable: true })
  payload!: unknown;

  @Column({ type: "int", unsigned: true })
  weight!: number;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: TaskStatus;

  @Column({ type: "int", nullable: true })
  priority!: number | null;

  @Column({ type: "int", unsigned: true, default: 0 })
  attempts!: number;

  @Column({ type: "int", unsigned: true, name: "max_attempts" })
  maxAttempts!: number;

  @Column({ type: "datetime", precision: 3, name: "scheduled_at", nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: "datetime", precision: 3, name: "claimed_at", nullable: true })
  claimedAt!: Date | null;

  @Column({ type: "varchar", length: 191, name: "claimed_by", nullable: true })
  claimedBy!: string | null;

  @Column({ type: "datetime", precision: 3, name: "started_at", nullable: true })
  startedAt!: Date | null;

  @Column({ type: "datetime", precision: 3, name: "completed_at", nullable: true })
  completedAt!: Date | null;

  @Column({ type: "text", name: "last_error", nullable: true })
  lastError!: string | null;

  @Column({ type: "enum", enum: TASK_SOURCES })
  source!: TaskSource;

  @Column({ type: "json", name: "source_meta", nullable: true })
  sourceMeta!: Record<string, unknown> | null;

  @Column({ type: "json", nullable: true })
  callback!: Record<string, unknown> | null;

  @Column({ type: "json", nullable: true })
  result!: unknown;

  @Column({ type: "varchar", length: 191, name: "correlation_id", nullable: true })
  correlationId!: string | null;

  @Column({ type: "varchar", length: 191, name: "idempotency_key", nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ type: "datetime", precision: 3, name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "datetime", precision: 3, name: "updated_at" })
  updatedAt!: Date;
}

export interface DispatchedTaskConfig {
  tableName?: string;
}

let configuredTableName: string | null = null;

/**
 * Override the SQL table name for `DispatchedTask` and rename its indexes accordingly.
 *
 * MUST be called before any TypeORM DataSource that registers `DispatchedTask` is initialized,
 * otherwise the metadata has already been read and the table will be created with the default name.
 *
 * Calling more than once is a no-op after the first call (the configuration is locked to keep
 * runtime behavior deterministic).
 */
export function configureDispatchedTask(opts: DispatchedTaskConfig) {
  if (configuredTableName !== null) return;
  const tableName = opts.tableName?.trim();
  if (!tableName || tableName === DEFAULT_TABLE_NAME) {
    configuredTableName = DEFAULT_TABLE_NAME;
    return;
  }
  const storage = getMetadataArgsStorage();
  for (const table of storage.tables) {
    if (table.target === DispatchedTask) {
      table.name = tableName;
    }
  }
  const indexPrefix = new RegExp(`^(ix|uq)_${DEFAULT_TABLE_NAME}_`);
  for (const idx of storage.indices) {
    if (idx.target !== DispatchedTask) continue;
    if (typeof idx.name === "string") {
      idx.name = idx.name.replace(indexPrefix, `$1_${tableName}_`);
    }
  }
  configuredTableName = tableName;
}

/** Returns the currently configured table name (or null if `configureDispatchedTask` was never called). */
export function getConfiguredDispatchedTaskTableName() {
  return configuredTableName;
}

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { TaskSource, TaskStatus } from "../../core/types.js";

@Entity("dispatched_task")
@Index("ix_dispatched_task_status", ["status"])
@Index("ix_dispatched_task_code", ["code"])
@Index("ix_dispatched_task_created_at", ["createdAt"])
@Index("ix_dispatched_task_correlation_id", ["correlationId"])
@Index("uq_dispatched_task_public_id", ["publicId"], { unique: true })
@Index("uq_dispatched_task_idempotency_key", ["idempotencyKey"], { unique: true, where: "idempotency_key IS NOT NULL" })
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

  @Column({ type: "varchar", length: 16 })
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

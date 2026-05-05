import { Between, In, LessThanOrEqual, MoreThanOrEqual } from "typeorm";
import type { FindOptionsWhere, Repository } from "typeorm";
import type { TaskStore } from "../task-store.interface.js";
import type { NewTaskRecord, TaskListFilters, TaskRecord, TaskStatus } from "../../core/types.js";
import { DispatchedTask } from "./dispatched-task.entity.js";

export interface TypeOrmTaskStoreOptions {
  repository: Repository<DispatchedTask>;
}

export class TypeOrmTaskStore implements TaskStore {
  private readonly repository: Repository<DispatchedTask>;

  constructor(options: TypeOrmTaskStoreOptions) {
    this.repository = options.repository;
  }

  async insert(input: NewTaskRecord) {
    const entity = this.repository.create({
      publicId: input.publicId,
      code: input.code,
      payload: input.payload,
      weight: input.weight,
      status: "pending",
      priority: input.priority,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      scheduledAt: input.scheduledAt,
      source: input.source,
      sourceMeta: input.sourceMeta,
      callback: input.callback,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
    });
    const saved = await this.repository.save(entity);
    return toRecord(saved);
  }

  async getByPublicId(publicId: string) {
    const found = await this.repository.findOne({ where: { publicId } });
    return found ? toRecord(found) : null;
  }

  async getByIdempotencyKey(key: string) {
    const found = await this.repository.findOne({ where: { idempotencyKey: key } });
    return found ? toRecord(found) : null;
  }

  async claim(publicId: string, claimedBy: string) {
    const result = await this.repository
      .createQueryBuilder()
      .update(DispatchedTask)
      .set({
        status: "claimed",
        claimedAt: () => "CURRENT_TIMESTAMP(3)",
        claimedBy,
        attempts: () => "attempts + 1",
      })
      .where("public_id = :publicId AND status IN (:...allowed)", {
        publicId,
        allowed: ["pending", "failed"] satisfies TaskStatus[],
      })
      .execute();
    if (!result.affected || result.affected === 0) return null;
    const updated = await this.repository.findOne({ where: { publicId } });
    return updated ? toRecord(updated) : null;
  }

  async markStarted(publicId: string) {
    await this.repository
      .createQueryBuilder()
      .update(DispatchedTask)
      .set({ status: "running", startedAt: () => "CURRENT_TIMESTAMP(3)" })
      .where({ publicId })
      .execute();
  }

  async markSucceeded(publicId: string, result: unknown) {
    await this.repository
      .createQueryBuilder()
      .update(DispatchedTask)
      .set({
        status: "succeeded",
        completedAt: () => "CURRENT_TIMESTAMP(3)",
        result: result as never,
        lastError: null,
      })
      .where({ publicId })
      .execute();
  }

  async markFailed(publicId: string, error: string, willRetry: boolean) {
    if (willRetry) {
      await this.repository
        .createQueryBuilder()
        .update(DispatchedTask)
        .set({ status: "failed", lastError: error })
        .where({ publicId })
        .execute();
    } else {
      await this.repository
        .createQueryBuilder()
        .update(DispatchedTask)
        .set({
          status: "dead",
          completedAt: () => "CURRENT_TIMESTAMP(3)",
          lastError: error,
        })
        .where({ publicId })
        .execute();
    }
  }

  async resetForRetry(publicId: string, scheduledAt: Date | null) {
    const result = await this.repository
      .createQueryBuilder()
      .update(DispatchedTask)
      .set({
        status: "pending",
        scheduledAt,
        claimedAt: null,
        claimedBy: null,
        startedAt: null,
        completedAt: null,
      })
      .where({ publicId })
      .execute();
    if (!result.affected || result.affected === 0) return null;
    const updated = await this.repository.findOne({ where: { publicId } });
    return updated ? toRecord(updated) : null;
  }

  async cancel(publicId: string) {
    const result = await this.repository
      .createQueryBuilder()
      .update(DispatchedTask)
      .set({ status: "cancelled", completedAt: () => "CURRENT_TIMESTAMP(3)" })
      .where("public_id = :publicId AND status IN (:...allowed)", {
        publicId,
        allowed: ["pending", "failed"] satisfies TaskStatus[],
      })
      .execute();
    if (!result.affected || result.affected === 0) return null;
    const updated = await this.repository.findOne({ where: { publicId } });
    return updated ? toRecord(updated) : null;
  }

  async list(filters: TaskListFilters) {
    const where: FindOptionsWhere<DispatchedTask> = {};
    if (filters.status) {
      where.status = Array.isArray(filters.status) ? In(filters.status) : filters.status;
    }
    if (filters.code) where.code = filters.code;
    if (filters.correlationId) where.correlationId = filters.correlationId;
    if (filters.fromCreatedAt && filters.toCreatedAt) {
      where.createdAt = Between(filters.fromCreatedAt, filters.toCreatedAt);
    } else if (filters.fromCreatedAt) {
      where.createdAt = MoreThanOrEqual(filters.fromCreatedAt);
    } else if (filters.toCreatedAt) {
      where.createdAt = LessThanOrEqual(filters.toCreatedAt);
    }
    const found = await this.repository.find({
      where,
      order: { createdAt: "DESC" },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    });
    return found.map(toRecord);
  }

  async pendingOrRunning() {
    const found = await this.repository.find({
      where: { status: In(["pending", "claimed", "running", "failed"] satisfies TaskStatus[]) },
      order: { createdAt: "ASC" },
    });
    return found.map(toRecord);
  }
}

function toRecord(entity: DispatchedTask) {
  const record: TaskRecord = {
    id: String(entity.id),
    publicId: entity.publicId,
    code: entity.code,
    payload: entity.payload,
    weight: entity.weight,
    status: entity.status,
    priority: entity.priority,
    attempts: entity.attempts,
    maxAttempts: entity.maxAttempts,
    scheduledAt: entity.scheduledAt,
    claimedAt: entity.claimedAt,
    claimedBy: entity.claimedBy,
    startedAt: entity.startedAt,
    completedAt: entity.completedAt,
    lastError: entity.lastError,
    source: entity.source,
    sourceMeta: entity.sourceMeta,
    callback: entity.callback,
    result: entity.result,
    correlationId: entity.correlationId,
    idempotencyKey: entity.idempotencyKey,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
  return record;
}

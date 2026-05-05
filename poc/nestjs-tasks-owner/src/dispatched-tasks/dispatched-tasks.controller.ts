import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { DispatchedTaskService } from "./dispatched-task.service";

@Controller("tasks")
export class DispatchedTasksController {
  constructor(private readonly tasks: DispatchedTaskService) {}

  @Post()
  @HttpCode(202)
  async enqueue(
    @Body()
    body: {
      code: string;
      payload?: unknown;
      idempotencyKey?: string | null;
      scheduledAt?: string | null;
      weight?: number;
      priority?: number | null;
      correlationId?: string | null;
    }
  ) {
    if (!body.code) {
      throw new NotFoundException("code is required");
    }
    const record = await this.tasks.enqueue({
      code: body.code,
      payload: body.payload ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      weight: body.weight,
      priority: body.priority ?? null,
      correlationId: body.correlationId ?? null,
      source: "http",
    });
    return { publicId: record.publicId, status: record.status };
  }

  @Get()
  async list(@Query("code") code?: string, @Query("limit") limit?: string) {
    return this.tasks.list({
      code,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get(":publicId")
  async get(@Param("publicId") publicId: string) {
    const r = await this.tasks.get(publicId);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Post(":publicId/retry")
  async retry(@Param("publicId") publicId: string) {
    const r = await this.tasks.retry(publicId);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Post(":publicId/cancel")
  async cancel(@Param("publicId") publicId: string) {
    const r = await this.tasks.cancel(publicId);
    if (!r) throw new NotFoundException();
    return r;
  }
}

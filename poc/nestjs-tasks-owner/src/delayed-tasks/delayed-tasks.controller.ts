import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { DelayedTaskService } from "./delayed-tasks.service.js";

@Controller("tasks")
export class DelayedTaskController {
  constructor(private readonly tasks: DelayedTaskService) {}

  @Post()
  @HttpCode(202)
  async enqueue(
    @Query("name") name: string,
    @Body() body: { data?: unknown; scheduledAt?: string; weight?: number }
  ) {
    if (!name || typeof name !== "string") throw new NotFoundException("query 'name' required");
    if (!this.tasks.has(name)) throw new NotFoundException(`unknown task '${name}'`);
    return this.tasks.enqueue({
      name,
      data: body?.data,
      scheduledAt: body?.scheduledAt ? new Date(body.scheduledAt) : undefined,
      weight: body?.weight,
    });
  }

  @Get()
  async list() {
    const [pending, finished, canceled] = await Promise.all([
      this.tasks.list.pending(),
      this.tasks.list.finished(),
      this.tasks.list.canceled(),
    ]);
    return { pending, finished, canceled };
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const r = await this.tasks.get(Number(id));
    if (!r) throw new NotFoundException();
    return r;
  }

  @Post(":id/cancel")
  async cancel(@Param("id") id: string) {
    const r = await this.tasks.cancel(Number(id));
    if (!r) throw new NotFoundException();
    return r;
  }

  @Post(":id/replay")
  async replay(@Param("id") id: string, @Body() body: { scheduledAt?: string }) {
    const r = await this.tasks.replay(Number(id), {
      scheduledAt: body?.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
    if (!r) throw new NotFoundException();
    return r;
  }
}

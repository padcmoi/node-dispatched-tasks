import { Module } from "@nestjs/common";
import { DelayedTaskController } from "./delayed-tasks.controller.js";
import { DelayedTaskService, dtRedisProvider } from "./delayed-tasks.service.js";

@Module({
  controllers: [DelayedTaskController],
  providers: [dtRedisProvider, DelayedTaskService],
  exports: [DelayedTaskService],
})
export class DelayedTasksModule {}

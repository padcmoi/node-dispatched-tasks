import { Module } from "@nestjs/common";
import { DispatchedTaskService, dataSourceProvider, redisProvider } from "./dispatched-task.service";
import { DispatchedTasksController } from "./dispatched-tasks.controller";

@Module({
  controllers: [DispatchedTasksController],
  providers: [dataSourceProvider, redisProvider, DispatchedTaskService],
  exports: [DispatchedTaskService],
})
export class DispatchedTasksModule {}

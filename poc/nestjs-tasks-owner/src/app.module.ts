import { Module } from "@nestjs/common";
import { DelayedTasksModule } from "./delayed-tasks/delayed-tasks.module.js";

@Module({
  imports: [DelayedTasksModule],
})
export class AppModule {}

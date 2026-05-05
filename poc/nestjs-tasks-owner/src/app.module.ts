import { Module } from "@nestjs/common";
import { DispatchedTasksModule } from "./dispatched-tasks/dispatched-tasks.module";

@Module({
  imports: [DispatchedTasksModule],
})
export class AppModule {}

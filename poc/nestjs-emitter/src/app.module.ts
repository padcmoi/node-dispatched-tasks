import { Module } from "@nestjs/common";
import { EchoController } from "./echo/echo.controller";
import { EmitterService } from "./emitter/emitter.service";

@Module({
  controllers: [EchoController],
  providers: [EmitterService],
})
export class AppModule {}

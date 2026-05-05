import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4001);
  await app.listen(port, "0.0.0.0");
  console.info(`[owner] listening on :${String(port)}`);
}

void bootstrap();

import { Body, Controller, Get, Post } from "@nestjs/common";

@Controller()
export class EchoController {
  @Post("echo")
  echo(@Body() body: unknown) {
    console.info("[nestjs-emitter] received /echo", body);
    return { ok: true, route: "echo" };
  }

  @Post("from-express")
  fromExpress(@Body() body: unknown) {
    console.info("[nestjs-emitter] received /from-express", body);
    return { ok: true, route: "from-express" };
  }

  @Get("healthz")
  health() {
    return { ok: true };
  }
}

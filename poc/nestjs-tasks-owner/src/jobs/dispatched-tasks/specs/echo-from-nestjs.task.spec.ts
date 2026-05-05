import echoFromNestjs from "../echo-from-nestjs.task";

describe("echo-from-nestjs.task", () => {
  it("declares the expected code and shape", () => {
    expect(echoFromNestjs.code).toBe("ECHO_FROM_NESTJS");
    expect(echoFromNestjs.weight).toBe(1);
    expect(echoFromNestjs.maxAttempts).toBe(3);
    expect(typeof echoFromNestjs.run).toBe("function");
  });

  it("validates payload with Zod (rejects bad input)", () => {
    const schema = echoFromNestjs.inputSchema;
    expect(schema).toBeDefined();
    const result = schema!.safeParse({ sender: 42 });
    expect(result.success).toBe(false);
  });
});

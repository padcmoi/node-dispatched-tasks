import echoFromExpress from "../echo-from-express.task";

describe("echo-from-express.task", () => {
  it("declares the expected code and shape", () => {
    expect(echoFromExpress.code).toBe("ECHO_FROM_EXPRESS");
    expect(echoFromExpress.weight).toBe(1);
    expect(echoFromExpress.maxAttempts).toBe(3);
    expect(typeof echoFromExpress.run).toBe("function");
  });

  it("validates payload with Zod (rejects bad input)", () => {
    const schema = echoFromExpress.inputSchema;
    expect(schema).toBeDefined();
    const result = schema!.safeParse({ sender: 42 });
    expect(result.success).toBe(false);
  });
});

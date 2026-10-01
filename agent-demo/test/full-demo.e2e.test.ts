import { createServer } from "node:http";
import { expect, it } from "vitest";
import { runAllScenarios } from "../src/demo.js";

it("stops before any scenario when an RPC already occupies the local demo port", async ({ skip }) => {
  const methods: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const call = JSON.parse(body) as { id: number; method: string };
      methods.push(call.method);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: { "solana-core": "test", "feature-set": 1 } }));
    });
  });

  let bindError: NodeJS.ErrnoException | undefined;
  await new Promise<void>((resolve) => {
    server.once("error", (error: NodeJS.ErrnoException) => ((bindError = error), resolve()));
    server.listen(8899, "127.0.0.1", resolve);
  });
  if (bindError?.code === "EADDRINUSE") skip("another validator owns port 8899; leaving it untouched");
  if (bindError) throw bindError;

  const lines: string[] = [];
  try {
    await expect(runAllScenarios((line) => lines.push(line))).rejects.toThrow(
      "Full A–F demo requires local RPC port 8899 to be free",
    );
    expect(methods).toEqual(["getVersion"]);
    expect(lines).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

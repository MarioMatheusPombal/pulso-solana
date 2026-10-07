import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ConfigError, loadConfig } from "./config.js";
import { createServer } from "./server.js";

try {
  const config = await loadConfig();
  const handle = serveStdio(() => createServer(config));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void handle.close().then(() => { process.exitCode = 0; }); });
  }
  console.error("PULSO MCP listening on stdio");
} catch (error) {
  // ConfigError messages are controlled; raw RPC/dependency errors may contain credentials.
  console.error(`PULSO MCP startup failed: ${error instanceof ConfigError ? error.message : "internal error"}`);
  process.exitCode = 1;
}

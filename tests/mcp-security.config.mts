// Run from the MCP workspace, reusing its installed dependencies and timeout policy.
import base from "../mcp-server/vitest.e2e.config.js";
import { fileURLToPath } from "node:url";
export default { ...base, resolve: { alias: { "@pulso/sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)) } }, test: { ...base.test, include: ["../tests/*.mcp.test.ts"], testTimeout: 120_000, fileParallelism: false } };

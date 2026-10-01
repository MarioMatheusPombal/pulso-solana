import { defineConfig } from "vitest/config";

// The default run is offline; the end-to-end suite boots a validator and has its own config.
export default defineConfig({ test: { exclude: ["node_modules", "test/e2e/**"] } });

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests hit the real database from .env (run: npm run test:integration).
process.loadEnvFile(".env");

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests-integration/**/*.test.ts"], environment: "node", testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});

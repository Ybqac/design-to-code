import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "e2e/**/*.test.ts"],
    environment: "node",
  },
});

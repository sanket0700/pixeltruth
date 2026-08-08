import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./vitest.server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // The rate-limit tests share one emulator project and mutate real
    // documents - run serially so one test's writes can't race another's.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  test: {
    include: ["src/**/*.test.ts"],
    reporters: ["verbose", "json"],
    outputFile: {
      json: path.join(root, "vitest-results.json"),
    },
  },
});

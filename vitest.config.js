import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["gvrm-format/**/*.js", "apps/preprocess/**/*.js"],
      exclude: ["tests/**"],
    },
  },
  resolve: {
    alias: {
      "@gvrm": path.resolve(__dirname, "./gvrm-format"),
      "@preprocess": path.resolve(__dirname, "./apps/preprocess"),
    },
  },
});

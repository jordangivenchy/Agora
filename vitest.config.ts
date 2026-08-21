import { defineConfig } from "vitest/config";
import path from "node:path";

/* Minimal Vitest config: make the `@/` path alias (from tsconfig) resolve in
   tests too, so test modules can runtime-import from `@/lib/...` the same way
   app code does. Purely additive — relative imports are unaffected. */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});

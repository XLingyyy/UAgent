import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["web/src/**/*.test.ts", "web/src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "web/src"),
    },
  },
});

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  return {
  // Resolve absent flags at build time so the acceptance entry is not emitted.
  define: {
    "import.meta.env.VITE_UAGENT_ENABLE_FIXTURES": JSON.stringify(env.VITE_UAGENT_ENABLE_FIXTURES === "1" ? "1" : "0"),
    "import.meta.env.VITE_UAGENT_ACCEPTANCE_UI": JSON.stringify(env.VITE_UAGENT_ACCEPTANCE_UI === "1" ? "1" : "0"),
  },
  plugins: [react()],
  root: resolve(__dirname),
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  };
});

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { build } = await import(new URL("./dist/node/index.js", pathToFileURL(require.resolve("vite/package.json"))).href);
await build({
  configFile: false,
  root: fileURLToPath(new URL("../apps/runtime-host/", import.meta.url)),
  build: {
    target: "node20",
    ssr: "src/main.ts",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { output: { format: "cjs", entryFileNames: "runtime-host.cjs" } },
  },
  ssr: { noExternal: ["@uagent/runtime", "@uagent/shared"] },
});

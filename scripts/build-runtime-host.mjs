import { createRequire } from "node:module";
import { mkdir, copyFile } from "node:fs/promises";
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
const resources = new URL("../apps/desktop/src-tauri/resources/runtime-host/", import.meta.url);
await mkdir(resources, { recursive: true });
await copyFile(new URL("../apps/runtime-host/dist/runtime-host.cjs", import.meta.url),
  new URL("runtime-host.cjs", resources));

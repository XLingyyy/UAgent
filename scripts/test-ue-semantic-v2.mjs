import { startVitest } from "vitest/node";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
const root = fileURLToPath(new URL("../packages/runtime/", import.meta.url));
const instance = await startVitest(
  "test",
  ["src/ue-semantic-v2.test.ts"],
  { root, config: false, watch: false, cache: false, pool: "forks", minWorkers: 1, maxWorkers: 1 },
  {
    esbuild: { tsconfigRaw: { compilerOptions: { target: "ES2022" } } },
    cacheDir:
      process.env.UAGENT_VITE_CACHE_DIR ??
      fileURLToPath(new URL("../tmp/vite-semantic-cache/", import.meta.url)),
  },
);
if (!instance) throw new Error("semantic v2 runner did not start");
try {
  if (
    instance.state.getUnhandledErrors().length ||
    instance.state.getFiles().some((file) => file.result?.state === "fail")
  )
    process.exitCode = 1;
} finally {
  await instance.close();
}

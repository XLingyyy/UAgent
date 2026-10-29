/** Export the exact transport schemas for the isolated T14 backend; writes only to stdout. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";
const source = readFileSync(
  new URL("../packages/runtime/src/ue-scene-batch-v2.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const policy = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const tools = policy.UE_SCENE_TOOLS.map((name) => ({
  name,
  inputSchema: policy.sceneInputSchema(name),
  outputSchema:
    name === policy.UE_SCENE_TOOLS[0]
      ? policy.sceneCapabilitiesSchema()
      : policy.sceneResultSchema(),
}));
process.stdout.write(
  `${JSON.stringify({ contractVersion: policy.UE_SCENE_CONTRACT, tools }, null, 2)}\n`,
);

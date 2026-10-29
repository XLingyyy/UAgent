import {
  createResponsesRuntimeSession,
  type ResponsesRuntimeSessionOptions,
} from "./responses/runtime-session.js";
/** Explicit wire contract selection. Unsupported protocols never fall back to another model/API. */
export function createProviderRuntimeSession(options: ResponsesRuntimeSessionOptions) {
  if (options.wireApi !== "responses") throw new Error("unsupported_runtime_provider_protocol");
  return createResponsesRuntimeSession(options);
}
export type { ResponsesRuntimeSessionOptions };

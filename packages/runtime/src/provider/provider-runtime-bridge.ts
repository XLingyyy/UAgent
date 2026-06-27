import type { ProviderRuntimeEvent, ProviderRuntimeRequest } from "@uagent/shared";
import type { ProviderAdapter } from "./provider-adapter.js";
import { runProviderComplete } from "./provider-runner.js";

export interface ProviderRuntimeBridgeOptions {
  adapter: ProviderAdapter;
  enabled: boolean;
}

export interface ProviderBridgeExecuteInput {
  system: string;
  developer: string;
  context: string[];
  constraints: string[];
  toolPolicy: string[];
  user: string;
  metadata: { providerId: string; providerModelId: string };
}

export interface ProviderBridgeExecuteResult {
  events: ProviderRuntimeEvent[];
}

export class ProviderRuntimeBridge {
  private adapter: ProviderAdapter;
  private enabled: boolean;

  constructor(options: ProviderRuntimeBridgeOptions) {
    this.adapter = options.adapter;
    this.enabled = options.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  async execute(
    input: ProviderBridgeExecuteInput,
    _draft: unknown,
    taskId: string,
    planId: string,
  ): Promise<ProviderBridgeExecuteResult> {
    const request: ProviderRuntimeRequest = {
      id: `provider-request-${taskId}-${planId}`,
      providerId: input.metadata.providerId,
      modelId: input.metadata.providerModelId,
      messages: [
        { role: "system", content: input.system },
        { role: "developer", content: buildDeveloperMessage(input) },
        { role: "user", content: buildUserMessage(input) },
      ],
      temperature: 0,
      maxOutputTokens: 1024,
      metadata: { taskId, planId },
    };

    const result = await runProviderComplete(this.adapter, request);
    return { events: result.events };
  }
}

function buildDeveloperMessage(input: ProviderBridgeExecuteInput): string {
  return [
    input.developer,
    "",
    ...input.context,
    "",
    ...input.constraints,
  ].join("\n");
}

function buildUserMessage(input: ProviderBridgeExecuteInput): string {
  return [
    input.user,
    "",
    ...input.toolPolicy,
  ].join("\n");
}

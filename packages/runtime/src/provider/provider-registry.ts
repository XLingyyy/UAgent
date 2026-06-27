import type { ProviderConfig, ProviderCapability } from "@uagent/shared";
import type { ProviderAdapter } from "./provider-adapter.js";

export interface ProviderRegistration {
  adapter: ProviderAdapter;
  config: ProviderConfig;
}

export interface ProviderRegistryValidationResult {
  valid: boolean;
  errors: string[];
}

export class ProviderRegistry {
  private readonly registrations = new Map<string, ProviderRegistration>();

  register(adapter: ProviderAdapter, config?: Partial<ProviderConfig>): ProviderRegistryValidationResult {
    const errors: string[] = [];

    if (this.registrations.has(adapter.id)) {
      errors.push(`Provider adapter is already registered: ${adapter.id}`);
      return { valid: false, errors };
    }

    if (!adapter.id) {
      errors.push("Provider adapter must have a non-empty id.");
    }

    const caps = adapter.getCapabilities();
    if (!caps.modelIds.length) {
      errors.push(`Provider adapter ${adapter.id} has no models configured.`);
    }

    if (config) {
      if (config.networkMode === "live" && !config.secretRef) {
        errors.push(`Provider ${adapter.id}: live network mode requires a secretRef.`);
      }
      if (config.baseUrl) {
        try {
          new URL(config.baseUrl);
        } catch {
          errors.push(`Provider ${adapter.id}: baseUrl "${config.baseUrl}" is not a valid URL.`);
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    const fullConfig: ProviderConfig = {
      providerId: adapter.id,
      displayName: config?.displayName ?? adapter.id,
      baseUrl: config?.baseUrl ?? "",
      wireApi: config?.wireApi ?? "mock",
      networkMode: config?.networkMode ?? "disabled",
      secretRef: config?.secretRef ?? null,
      models: caps.modelIds,
      defaultModel: config?.defaultModel ?? caps.modelIds[0] ?? null,
      isFixture: caps.isMock,
    };

    this.registrations.set(adapter.id, { adapter, config: fullConfig });
    return { valid: true, errors: [] };
  }

  get(providerId: string): ProviderAdapter {
    const registration = this.registrations.get(providerId);
    if (!registration) {
      throw new Error(`Provider adapter is not registered: ${providerId}`);
    }
    return registration.adapter;
  }

  getConfig(providerId: string): ProviderConfig {
    const registration = this.registrations.get(providerId);
    if (!registration) {
      throw new Error(`Provider config not found: ${providerId}`);
    }
    return registration.config;
  }

  listCapabilities(): ProviderCapability[] {
    return [...this.registrations.values()].map((r) => r.adapter.getCapabilities());
  }

  listProviders(): ProviderRegistration[] {
    return [...this.registrations.values()];
  }

  listProviderIds(): string[] {
    return [...this.registrations.keys()];
  }

  hasProvider(providerId: string): boolean {
    return this.registrations.has(providerId);
  }

  unregister(providerId: string): boolean {
    return this.registrations.delete(providerId);
  }

  updateConfig(providerId: string, configUpdate: Partial<ProviderConfig>): ProviderRegistryValidationResult {
    const registration = this.registrations.get(providerId);
    if (!registration) {
      return { valid: false, errors: [`Provider not found: ${providerId}`] };
    }

    const updatedConfig = { ...registration.config, ...configUpdate };
    const errors: string[] = [];

    if (updatedConfig.networkMode === "live" && !updatedConfig.secretRef) {
      errors.push(`Provider ${providerId}: live network mode requires a secretRef.`);
    }
    if (updatedConfig.baseUrl) {
      try {
        new URL(updatedConfig.baseUrl);
      } catch {
        errors.push(`Provider ${providerId}: baseUrl "${updatedConfig.baseUrl}" is not a valid URL.`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    this.registrations.set(providerId, { ...registration, config: updatedConfig });
    return { valid: true, errors: [] };
  }

  clear(): void {
    this.registrations.clear();
  }

  get count(): number {
    return this.registrations.size;
  }
}

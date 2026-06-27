import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "./provider-registry.js";
import { MockTextProvider, MockStreamingProvider } from "./mock-provider.js";

describe("ProviderRegistry", () => {
  it("registers a provider adapter successfully", () => {
    const registry = new ProviderRegistry();
    const result = registry.register(new MockTextProvider());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(registry.listProviderIds()).toEqual(["mock-text"]);
  });

  it("rejects duplicate registration", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockTextProvider());
    const result = registry.register(new MockTextProvider());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("already registered");
  });

  it("rejects live mode without secretRef", () => {
    const registry = new ProviderRegistry();
    const result = registry.register(new MockTextProvider(), {
      networkMode: "live",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("secretRef");
  });

  it("rejects invalid baseUrl", () => {
    const registry = new ProviderRegistry();
    const result = registry.register(new MockTextProvider(), {
      baseUrl: "not-a-url",
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not a valid URL");
  });

  it("accepts valid baseUrl", () => {
    const registry = new ProviderRegistry();
    const result = registry.register(new MockTextProvider(), {
      baseUrl: "https://api.openai.com/v1",
      networkMode: "fixture",
      secretRef: "test-key",
    });
    expect(result.valid).toBe(true);
  });

  it("retrieves adapter and config by id", () => {
    const registry = new ProviderRegistry();
    const adapter = new MockTextProvider();
    registry.register(adapter);
    expect(registry.get("mock-text")).toBe(adapter);
    const config = registry.getConfig("mock-text");
    expect(config.providerId).toBe("mock-text");
    expect(config.networkMode).toBe("disabled");
  });

  it("lists providers", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockTextProvider());
    registry.register(new MockStreamingProvider());
    expect(registry.listProviderIds()).toHaveLength(2);
    expect(registry.count).toBe(2);
    expect(registry.listCapabilities()).toHaveLength(2);
  });

  it("unregisters a provider", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockTextProvider());
    expect(registry.hasProvider("mock-text")).toBe(true);
    registry.unregister("mock-text");
    expect(registry.hasProvider("mock-text")).toBe(false);
  });

  it("updates config", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockTextProvider(), { networkMode: "disabled" });
    const result = registry.updateConfig("mock-text", { networkMode: "fixture" });
    expect(result.valid).toBe(true);
    expect(registry.getConfig("mock-text").networkMode).toBe("fixture");
  });

  it("rejects update to live without secretRef", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockTextProvider());
    const result = registry.updateConfig("mock-text", { networkMode: "live" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("secretRef");
  });

  it("clears all registrations", () => {
    const registry = new ProviderRegistry();
    registry.register(new MockTextProvider());
    registry.register(new MockStreamingProvider());
    registry.clear();
    expect(registry.count).toBe(0);
  });
});

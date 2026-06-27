import { describe, it, expect } from "vitest";
import { InMemorySecretStore } from "./secret-store.js";

describe("InMemorySecretStore", () => {
  it("stores and retrieves a secret", () => {
    const store = new InMemorySecretStore();
    store.put("openai-key", "sk-test1234567890abcdef");
    expect(store.get("openai-key")).toBe("sk-test1234567890abcdef");
  });

  it("returns undefined for missing ref", () => {
    const store = new InMemorySecretStore();
    expect(store.get("missing")).toBeUndefined();
  });

  it("deletes a secret", () => {
    const store = new InMemorySecretStore();
    store.put("test-key", "value");
    store.delete("test-key");
    expect(store.has("test-key")).toBe(false);
  });

  it("lists all refs", () => {
    const store = new InMemorySecretStore();
    store.put("key-a", "value-a");
    store.put("key-b", "value-b");
    expect(store.listRefs()).toEqual(["key-a", "key-b"]);
  });

  it("checks existence", () => {
    const store = new InMemorySecretStore();
    store.put("exists", "value");
    expect(store.has("exists")).toBe(true);
    expect(store.has("missing")).toBe(false);
  });

  it("clears all secrets", () => {
    const store = new InMemorySecretStore();
    store.put("key-a", "value-a");
    store.put("key-b", "value-b");
    store.clear();
    expect(store.listRefs()).toEqual([]);
  });
});

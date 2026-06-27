import { describe, it, expect } from "vitest";
import { createProviderHttpTransport } from "./provider-http-transport.js";

describe("createProviderHttpTransport", () => {
  describe("default disabled mode", () => {
    it("rejects sendJson when disabled", async () => {
      const transport = createProviderHttpTransport();
      await expect(
        transport.sendJson({ url: "http://test", method: "POST", headers: {} }),
      ).rejects.toThrow("disabled");
    });

    it("rejects streamSse when disabled", async () => {
      const transport = createProviderHttpTransport();
      const iterator = transport.streamSse({ url: "http://test", method: "POST", headers: {} })[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toThrow("disabled");
    });

    it("reports disabled networkMode", () => {
      const transport = createProviderHttpTransport();
      expect(transport.networkMode).toBe("disabled");
    });
  });

  describe("fixture mode", () => {
    it("returns fixture JSON response for sendJson", async () => {
      const transport = createProviderHttpTransport({ networkMode: "fixture" });
      const response = await transport.sendJson({ url: "http://test", method: "POST", headers: {} });
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("id", "fixture-response");
      expect(body).toHaveProperty("choices");
    });

    it("yields fixture SSE chunks for streamSse", async () => {
      const transport = createProviderHttpTransport({ networkMode: "fixture" });
      const chunks: string[] = [];
      for await (const chunk of transport.streamSse({ url: "http://test", method: "POST", headers: {} })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toContain("Fixture");
      expect(chunks.some((c) => c.includes("[DONE]"))).toBe(true);
    });
  });

  describe("live mode", () => {
    it("rejects without explicit enableLive", async () => {
      const transport = createProviderHttpTransport({ networkMode: "live" });
      await expect(
        transport.sendJson({ url: "http://test", method: "POST", headers: {} }),
      ).rejects.toThrow("opt-in");
    });

    it("allows requests after enableLive", () => {
      const transport = createProviderHttpTransport({ networkMode: "live" });
      transport.enableLive();
      expect(transport.networkMode).toBe("live");
    });

    it("rejects live requests without a secretRef even after explicit opt-in", async () => {
      const transport = createProviderHttpTransport({ networkMode: "live" });
      transport.enableLive();

      await expect(
        transport.sendJson({ url: "http://test", method: "POST", headers: {} }),
      ).rejects.toThrow("secretRef");
    });
  });

  describe("getBaseUrl", () => {
    it("returns configured base URL", () => {
      const transport = createProviderHttpTransport({ baseUrl: "https://api.openai.com/v1" });
      expect(transport.getBaseUrl()).toBe("https://api.openai.com/v1");
    });

    it("returns empty string by default", () => {
      const transport = createProviderHttpTransport();
      expect(transport.getBaseUrl()).toBe("");
    });
  });
});

import { describe, it, expect } from "vitest";
import { createDefaultSandboxPolicy, type SandboxPolicy } from "@uagent/shared";
import {
  evaluateSandboxPolicy,
  createFixtureSandboxPolicy,
  DEFAULT_BLOCKED_CAPABILITIES,
} from "./sandbox-policy.js";

describe("sandbox-policy", () => {
  describe("default policy", () => {
    it("blocks network capability", () => {
      const policy = createDefaultSandboxPolicy();
      const result = evaluateSandboxPolicy(policy, "network");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked by default");
    });

    it("blocks process capability", () => {
      const policy = createDefaultSandboxPolicy();
      const result = evaluateSandboxPolicy(policy, "process");
      expect(result.allowed).toBe(false);
    });

    it("blocks fs_write capability", () => {
      const policy = createDefaultSandboxPolicy();
      const result = evaluateSandboxPolicy(policy, "fs_write");
      expect(result.allowed).toBe(false);
    });

    it("blocks ue_write capability", () => {
      const policy = createDefaultSandboxPolicy();
      const result = evaluateSandboxPolicy(policy, "ue_write");
      expect(result.allowed).toBe(false);
    });

    it("allows fixture capabilities in fixture mode", () => {
      const policy = createDefaultSandboxPolicy();
      const result = evaluateSandboxPolicy(policy, "fixture_read");
      expect(result.allowed).toBe(true);
    });
  });

  describe("fixture policy", () => {
    it("allows fixture capabilities", () => {
      const policy = createFixtureSandboxPolicy();
      expect(evaluateSandboxPolicy(policy, "fixture_read").allowed).toBe(true);
      expect(evaluateSandboxPolicy(policy, "fixture_write").allowed).toBe(true);
    });

    it("blocks network by default", () => {
      const policy = createFixtureSandboxPolicy();
      const result = evaluateSandboxPolicy(policy, "network");
      expect(result.allowed).toBe(false);
    });

    it("returns expected defaults", () => {
      const policy = createFixtureSandboxPolicy();
      expect(policy.mode).toBe("fixture");
      expect(policy.networkPolicy).toBe("fixture_only");
      expect(policy.outputLimit).toBe(4096);
      expect(policy.timeoutTicks).toBe(100);
      expect(policy.capabilities).toEqual({
        fixture_read: "allow",
        fixture_write: "allow",
      });
    });
  });

  describe("capability allow/block override", () => {
    it("allows an overridden capability", () => {
      const policy: SandboxPolicy = {
        ...createDefaultSandboxPolicy(),
        capabilities: { network: "allow" },
      };
      const result = evaluateSandboxPolicy(policy, "network");
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("explicitly allowed");
    });

    it("blocks an overridden capability", () => {
      const policy: SandboxPolicy = {
        ...createDefaultSandboxPolicy(),
        capabilities: { fixture_read: "block" },
      };
      const result = evaluateSandboxPolicy(policy, "fixture_read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("explicitly blocked");
    });
  });

  describe("DEFAULT_BLOCKED_CAPABILITIES", () => {
    it("contains expected default blocked capabilities", () => {
      expect(DEFAULT_BLOCKED_CAPABILITIES).toHaveProperty("process");
      expect(DEFAULT_BLOCKED_CAPABILITIES).toHaveProperty("network");
      expect(DEFAULT_BLOCKED_CAPABILITIES).toHaveProperty("fs_write");
      expect(DEFAULT_BLOCKED_CAPABILITIES).toHaveProperty("ue_write");
    });
  });
});

import { type SandboxPolicy } from "@uagent/shared";

export const DEFAULT_BLOCKED_CAPABILITIES: Record<string, true> = {
  process: true,
  network: true,
  fs_write: true,
  ue_write: true,
};

export function evaluateSandboxPolicy(
  policy: SandboxPolicy,
  capability: string,
): { allowed: boolean; reason: string } {
  const override = policy.capabilities[capability];
  if (override === "allow") {
    return { allowed: true, reason: `capability "${capability}" explicitly allowed` };
  }
  if (override === "block") {
    return { allowed: false, reason: `capability "${capability}" explicitly blocked` };
  }

  if (DEFAULT_BLOCKED_CAPABILITIES[capability]) {
    return { allowed: false, reason: `capability "${capability}" blocked by default` };
  }

  if (policy.mode === "fixture") {
    return { allowed: true, reason: "fixture mode" };
  }

  if (capability.startsWith("fixture_")) {
    return { allowed: true, reason: "fixture capability" };
  }

  return { allowed: false, reason: `capability "${capability}" not permitted by policy` };
}

export function createFixtureSandboxPolicy(): SandboxPolicy {
  return {
    mode: "fixture",
    capabilities: {
      fixture_read: "allow",
      fixture_write: "allow",
    },
    cwdRef: null,
    envPolicy: {},
    networkPolicy: "fixture_only",
    outputLimit: 4096,
    timeoutTicks: 100,
  };
}

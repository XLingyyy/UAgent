import { describe, expect, it, vi } from "vitest";
import { createSafeProviderSession } from "./safe-provider-session";
import type { NativeInvoke } from "./project-native-adapter";

const profileId = "a".repeat(64);
const receipt = { profileId, providerId: "deepseek", modelId: "deepseek-flash" };
function fixture(opening?: Promise<typeof receipt>) {
  const invoke = vi.fn(async (command: string) => {
    if (command === "get_product_provider_version") return { providerId: "deepseek", generation: "test", revision: 1, exists: true };
    if (command === "open_host_model_profile") return opening ?? receipt;
    if (command === "close_host_model_profile") return;
    throw Error("unexpected_native_request");
  });
  const session = createSafeProviderSession({ mode: "live", liveAuthorized: true,
    nativeInvoke: invoke as NativeInvoke, fetcher: vi.fn(async () => { throw Error("unexpected_network"); }) });
  return { session, invoke };
}

describe("native task model setup through the existing temporary session", () => {
  it("pins the native configuration and revokes task credentials on explicit close", async () => {
    const { session, invoke } = fixture();
    try {
      expect(await session.openHostedAccount("synthetic-host-key-only")).toBe(true);
      expect(session.getHostedProfileId()).toBe(profileId);
      expect(invoke).toHaveBeenCalledWith("open_host_model_profile", { input: {
        providerId: "deepseek", modelId: "deepseek-flash", credential: "synthetic-host-key-only",
        expectedProviderVersion: { providerId: "deepseek", generation: "test", revision: 1, exists: true },
      } });
      expect(JSON.stringify(session.getSnapshot())).not.toContain("synthetic-host-key-only");
      await session.closeAsync("cleared");
      expect(invoke).toHaveBeenCalledWith("close_host_model_profile", { input: { profileId } });
      expect(session.getHostedProfileId()).toBeNull();
    } finally { session.dispose(); }
  });

  it("detaches on view unload while native app lifetime owns running tasks", async () => {
    const { session, invoke } = fixture();
    await session.openHostedAccount("synthetic-host-key-only");
    const target = new EventTarget(), detach = session.attachLifetime(target);
    target.dispatchEvent(new Event("beforeunload"));
    await session.whenSettled();
    expect(session.getHostedProfileId()).toBeNull();
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain("close_host_model_profile");
    detach();session.dispose();
  });

  it("cleans up a late native setup after cancellation without reopening the session", async () => {
    let finish!: (value: typeof receipt) => void;
    const opening = new Promise<typeof receipt>(resolve => { finish = resolve; });
    const { session, invoke } = fixture(opening);
    const pending = session.openHostedAccount("synthetic-host-key-only");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("open_host_model_profile", expect.anything()));
    session.cancelSetup();finish(receipt);
    expect(await pending).toBe(false);
    await session.whenSettled();
    expect(session.getSnapshot().ready).toBe(false);
    expect(invoke).toHaveBeenCalledWith("close_host_model_profile", { input: { profileId } });
    session.dispose();
  });
});

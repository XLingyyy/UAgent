import { describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { UIProvider, useUI } from "./providers";
import type { ProviderConfig } from "../types/provider";
import * as Runtime from "@uagent/runtime";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

type NativeInvoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

const NATIVE_APP_HARNESS_PREFIX = "UAGENT_MVP15D_NATIVE_APP_HARNESS:";

interface NativeAppHarness {
  invoke<T>(command: string, input?: Record<string, unknown>): Promise<T>;
  stop(): Promise<void>;
}

async function startNativeAppHarness(): Promise<NativeAppHarness> {
  const manifestPath = resolve(process.cwd(), "src-tauri", "Cargo.toml");
  const child: ChildProcessWithoutNullStreams = spawn(
    "cargo",
    [
      "test",
      "--manifest-path",
      manifestPath,
      "mvp15d_runtime_bridge::tests::mvp15d_native_app_harness_server",
      "--lib",
      "--",
      "--exact",
      "--nocapture",
      "--test-threads=1",
    ],
    {
      env: { ...process.env, UAGENT_MVP15D_NATIVE_APP_HARNESS: "1" },
      windowsHide: true,
    },
  );
  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => stderr.push(chunk));
  let nextId = 0;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const marker = line.indexOf(NATIVE_APP_HARNESS_PREFIX);
    if (marker < 0) return;
    const message = JSON.parse(line.slice(marker + NATIVE_APP_HARNESS_PREFIX.length)) as {
      ready?: boolean;
      id?: number;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (message.ready) {
      readyResolve?.();
      readyResolve = null;
      readyReject = null;
      return;
    }
    if (!Number.isSafeInteger(message.id)) return;
    const request = pending.get(message.id!);
    if (!request) return;
    pending.delete(message.id!);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error ?? "MVP15D_NATIVE_APP_HARNESS_FAILED"));
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      const error = new Error(
        `MVP15D_NATIVE_APP_HARNESS_EXITED:${code ?? "signal"}:${stderr.join("")}`,
      );
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      if (code === 0) resolve();
      else reject(error);
      readyReject?.(error);
    });
  });
  const invoke = <T,>(command: string, input: Record<string, unknown> = {}): Promise<T> => {
    nextId += 1;
    return new Promise<T>((resolve, reject) => {
      pending.set(nextId, { resolve: resolve as (value: unknown) => void, reject });
      child.stdin.write(`${JSON.stringify({ id: nextId, command, input })}\n`, (error) => {
        if (!error) return;
        pending.delete(nextId);
        reject(error);
      });
    });
  };
  await ready;
  return {
    invoke,
    stop: async () => {
      if (child.exitCode === null) {
        await invoke("shutdown");
        child.stdin.end();
      }
      await exited;
    },
  };
}

function appWiringNativeEvidence() {
  const base = {
    schemaVersion: "uagent.ue-companion-plugin.build-manifest.v3" as const,
    taskGeneration: "final-d13-d16" as const,
    taskId: "TASK-MVP15D-APP-WIRING",
    pluginId: "UAgentAssetTools" as const,
    pluginVersion: "0.1.0" as const,
    contractVersion: "mvp15d.asset-tools.v1" as const,
    sourceCommit: "a".repeat(40),
    sourceTreeSha256: "b".repeat(64),
    physicalFixtures: [
      { path: "fixture-a.json", size: 1, sha256: "2".repeat(64), gitObjectSha256: "2".repeat(64) },
      { path: "fixture-b.json", size: 1, sha256: "3".repeat(64), gitObjectSha256: "3".repeat(64) },
    ],
    dirty: false as const,
    engineVersion: "5.8.1" as const,
    engineChangelist: 56057345 as const,
    compatibleChangelist: 55116800 as const,
    moduleBuildId: "55116800" as const,
    targetPlatform: "Win64" as const,
    configuration: "Development" as const,
    compiler: { name: "MSVC" as const, version: "14.44.35207" },
    windowsSdk: { name: "Windows SDK" as const, version: "10.0.26100.0" },
    buildCommandFingerprint: "c".repeat(64),
    buildEvidenceArtifacts: [
      { path: "logs/stdout.log", size: 1, sha256: "4".repeat(64) },
      { path: "metadata/build-command.json", size: 1, sha256: "5".repeat(64) },
      { path: "metadata/build-result.json", size: 1, sha256: "6".repeat(64) },
    ],
    artifacts: [
      { path: "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", size: 3, sha256: "f".repeat(64) },
      { path: "Binaries/Win64/UnrealEditor.modules", size: 3, sha256: "1".repeat(64) },
      { path: "Resources/uagent-asset-tools.schema.json", size: 2, sha256: "e".repeat(64) },
      { path: "UAgentAssetTools.uplugin", size: 1, sha256: "d".repeat(64) },
    ],
    modules: [{ path: "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", size: 3, sha256: "f".repeat(64) }],
    toolNames: [...Runtime.MVP15_ASSET_TOOL_ALLOWLIST],
    generatedAt: "2026-08-08T00:00:00.000Z",
    builder: { kind: "local" as const, name: "app-wiring-test" },
  };
  const manifest = {
    ...base,
    manifestSelfSha256: Runtime.computeMvp15DManifestSha256({ ...base, manifestSelfSha256: "" }),
  };
  const modules = manifest.modules.map((module) => ({
    name: module.path.split("/").at(-1)!,
    size: module.size,
    sha256: module.sha256,
  }));
  const identity = {
    schemaVersion: "uagent.ue-companion-plugin.identity.v2" as const,
    pluginId: manifest.pluginId,
    pluginVersion: manifest.pluginVersion,
    contractVersion: manifest.contractVersion,
    sourceCommit: manifest.sourceCommit,
    buildManifestSha256: manifest.manifestSelfSha256,
    engineVersion: manifest.engineVersion,
    engineChangelist: manifest.engineChangelist,
    compatibleChangelist: manifest.compatibleChangelist,
    moduleBuildId: manifest.moduleBuildId,
    sourceTreeSha256: manifest.sourceTreeSha256,
    buildCommandFingerprint: manifest.buildCommandFingerprint,
    loadedModuleName: modules[0]!.name,
    loadedModuleSha256: modules[0]!.sha256,
  };
  return {
    manifest,
    installedModules: modules,
    loadedModules: modules,
    descriptors: Runtime.createMvp15DCompanionToolDescriptors(identity),
  };
}

function Probe() {
  const {
    state,
    toggleInspector,
    setActiveProject,
    setActiveNav,
    setActiveThread,
    setTheme,
    openSettings,
    closeSettings,
    setActiveSettingsPage,
    setComposerInput,
    setComposerPermission,
    setComposerModel,
    setComposerReasoning,
  } = useUI();

  return (
    <div>
      <span data-testid="inspector-open">{String(state.layout.inspector.open)}</span>
      <span data-testid="theme">{state.layout.theme}</span>
      <span data-testid="active-nav">{state.layout.sidebar.activeNav}</span>
      <span data-testid="active-project">{state.project.activeProjectId ?? "null"}</span>
      <span data-testid="active-thread">{state.thread.activeThreadId ?? "null"}</span>
      <span data-testid="settings-open">{String(state.settings.open)}</span>
      <span data-testid="settings-page">{state.settings.activePageId}</span>
      <span data-testid="composer-input">{state.composer.input}</span>
      <span data-testid="composer-permission">{state.composer.permission}</span>
      <span data-testid="composer-model">{state.composer.selectedModelId}</span>
      <span data-testid="composer-reasoning">{state.composer.reasoningEffort}</span>
      <button type="button" onClick={toggleInspector}>
        toggle
      </button>
      <button type="button" onClick={() => setTheme("light")} data-testid="set-light-theme">
        set light
      </button>
      <button type="button" onClick={() => setActiveNav("projects")} data-testid="set-projects">
        set projects
      </button>
      <button type="button" onClick={() => setActiveThread("thread-2")} data-testid="set-thread">
        set thread
      </button>
      <button type="button" onClick={() => setActiveProject("mech")} data-testid="set-mech">
        set mech
      </button>
      <button type="button" onClick={() => setActiveProject(null)} data-testid="set-none">
        set none
      </button>
      <button type="button" onClick={() => openSettings()} data-testid="open-settings-default">
        open settings
      </button>
      <button
        type="button"
        onClick={() => openSettings("provider")}
        data-testid="open-settings-provider"
      >
        open provider
      </button>
      <button
        type="button"
        onClick={() => setActiveSettingsPage("appearance")}
        data-testid="set-page-appearance"
      >
        set appearance
      </button>
      <button type="button" onClick={closeSettings} data-testid="close-settings">
        close settings
      </button>
      <button
        type="button"
        onClick={() => setComposerInput("draft prompt")}
        data-testid="set-composer-input"
      >
        set composer input
      </button>
      <button
        type="button"
        onClick={() => setComposerPermission("auto-approve")}
        data-testid="set-composer-permission"
      >
        set composer permission
      </button>
      <button
        type="button"
        onClick={() => setComposerModel("openai-gpt-5")}
        data-testid="set-composer-model"
      >
        set composer model
      </button>
      <button
        type="button"
        onClick={() => setComposerReasoning("high")}
        data-testid="set-composer-reasoning"
      >
        set composer reasoning
      </button>
    </div>
  );
}

describe("UIProvider", () => {
  it("starts with the inspector closed by default", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
  });

  it("starts with dark theme by default", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("updates theme through setTheme", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("set-light-theme"));
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("toggles the inspector open then closed", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    const button = screen.getByText("toggle");
    fireEvent.click(button);
    expect(screen.getByTestId("inspector-open").textContent).toBe("true");
    fireEvent.click(button);
    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
  });

  it("respects a custom initial inspector state", () => {
    render(
      <UIProvider initialState={{ layout: { inspector: { open: false } } }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("inspector-open").textContent).toBe("false");
  });

  it("starts with default active project lyra", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("lyra");
  });

  it("sets active project to mech", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("set-mech"));
    expect(screen.getByTestId("active-project").textContent).toBe("mech");
  });

  it("sets active project to null (no project)", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    fireEvent.click(screen.getByTestId("set-none"));
    expect(screen.getByTestId("active-project").textContent).toBe("null");
  });

  it("accepts custom initial activeProjectId", () => {
    render(
      <UIProvider initialState={{ project: { activeProjectId: "city" } }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("city");
  });

  it("accepts null initial activeProjectId", () => {
    render(
      <UIProvider initialState={{ project: { activeProjectId: null } }}>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-project").textContent).toBe("null");
  });

  it("starts with workspace nav and no active thread selected", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );
    expect(screen.getByTestId("active-nav").textContent).toBe("workspace");
    expect(screen.getByTestId("active-thread").textContent).toBe("null");
  });

  it("updates nav and thread in their own stores", () => {
    render(
      <UIProvider>
        <Probe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByTestId("set-projects"));
    fireEvent.click(screen.getByTestId("set-thread"));

    expect(screen.getByTestId("active-nav").textContent).toBe("projects");
    expect(screen.getByTestId("active-thread").textContent).toBe("thread-2");
  });

  describe("composer store", () => {
    it("starts with the default mock composer values", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );

      expect(screen.getByTestId("composer-input").textContent).toBe("");
      expect(screen.getByTestId("composer-permission").textContent).toBe("request-approval");
      expect(screen.getByTestId("composer-model").textContent).toBe("not-configured");
      expect(screen.getByTestId("composer-reasoning").textContent).toBe("medium");
    });

    it("updates composer slices through dedicated actions", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );

      fireEvent.click(screen.getByTestId("set-composer-input"));
      fireEvent.click(screen.getByTestId("set-composer-permission"));
      fireEvent.click(screen.getByTestId("set-composer-model"));
      fireEvent.click(screen.getByTestId("set-composer-reasoning"));

      expect(screen.getByTestId("composer-input").textContent).toBe("draft prompt");
      expect(screen.getByTestId("composer-permission").textContent).toBe("auto-approve");
      expect(screen.getByTestId("composer-model").textContent).toBe("openai-gpt-5");
      expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
    });

    it("derives initial composer selection from the provider store default", () => {
      const customProviders: ProviderConfig[] = [
        {
          providerId: "studio",
          displayName: "Studio",
          baseUrl: "https://mock.studio.local/v1",
          wireApi: "responses",
          authMode: "env_key",
          secretRef: "STUDIO_KEY",
          enabled: true,
          models: [
            {
              id: "studio-gpt-5-1",
              label: "GPT-5.1 Custom",
              contextWindow: 256000,
              supportsReasoning: true,
              reasoningEfforts: ["medium", "high", "xhigh"],
            },
          ],
          defaultModel: "studio-gpt-5-1",
          defaultReasoningEffort: "high",
        },
      ];

      render(
        <UIProvider
          initialState={{
            provider: {
              providers: customProviders,
              selectedProviderId: "studio",
              defaultProviderId: "studio",
            },
          }}
        >
          <Probe />
        </UIProvider>,
      );

      expect(screen.getByTestId("composer-model").textContent).toBe("studio-gpt-5-1");
      expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
    });
  });

  describe("settings state", () => {
    it("starts with settings closed by default", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      expect(screen.getByTestId("settings-open").textContent).toBe("false");
    });

    it("defaults active settings page to general", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      expect(screen.getByTestId("settings-page").textContent).toBe("general");
    });

    it("opens settings with default page on openSettings()", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-default"));
      expect(screen.getByTestId("settings-open").textContent).toBe("true");
      expect(screen.getByTestId("settings-page").textContent).toBe("general");
    });

    it("opens settings to provider page on openSettings('provider')", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-provider"));
      expect(screen.getByTestId("settings-open").textContent).toBe("true");
      expect(screen.getByTestId("settings-page").textContent).toBe("provider");
    });

    it("sets active settings page to appearance", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("set-page-appearance"));
      expect(screen.getByTestId("settings-page").textContent).toBe("appearance");
    });

    it("closes settings on closeSettings()", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-default"));
      fireEvent.click(screen.getByTestId("close-settings"));
      expect(screen.getByTestId("settings-open").textContent).toBe("false");
    });

    it("preserves active page after close and reopen with same page", () => {
      render(
        <UIProvider>
          <Probe />
        </UIProvider>,
      );
      fireEvent.click(screen.getByTestId("open-settings-provider"));
      fireEvent.click(screen.getByTestId("close-settings"));
      fireEvent.click(screen.getByTestId("open-settings-provider"));
      expect(screen.getByTestId("settings-page").textContent).toBe("provider");
    });
  });
});

describe("MVP15D production App registry wiring", () => {
  it("runs predecessor request, parent acknowledgement, successor claim, and final publish through two actual App registrations", async () => {
    const harness = await startNativeAppHarness();
    const commands: string[] = [];
    let mcpSessionSequence = 0;
    let nativeGeneration = 8_000_000_000_000_000;
    const evidence = appWiringNativeEvidence();
    const invoke: NativeInvoke = async <T,>(
      command: string,
      payload?: Record<string, unknown>,
    ) => {
      commands.push(command);
      const input = (payload?.input as Record<string, unknown> | undefined) ?? {};
      if (
        command === "mvp15d_bridge_configuration" ||
        command === "mvp15d_bridge_take_driver_command" ||
        command === "mvp15d_bridge_record_renderer_step" ||
        command === "mvp15d_bridge_observe_native_state" ||
        command === "mvp15d_bridge_request_renderer_restart" ||
        command === "mvp15d_bridge_claim_renderer_restart" ||
        command === "mvp15d_bridge_publish_product_evidence" ||
        command === "mvp15d_bridge_complete"
      ) {
        return harness.invoke<T>(command, input);
      }
      if (command === "validate_native_project_root") {
        return {
          ok: true,
          reason: "valid",
          displayRoot: "[project-root]/FinalHost",
          projectName: "FinalHost",
          engine: { label: "UE 5.8.1", association: null, source: "native" },
        } as T;
      }
      if (command === "trust_native_project_root") {
        return {
          rootId: "root:app-wiring",
          displayRoot: "[project-root]/FinalHost",
          trustState: "trusted",
        } as T;
      }
      if (command === "editor_observation_capability_status") {
        return {
          enabled: true,
          mode: "native",
          reason: "ue_editor_bridge_feature_enabled",
          trustedRootRequired: true,
          mutationExecution: "blocked",
        } as T;
      }
      if (command === "discover_editor_processes") {
        return {
          status: "ready",
          reason: "native_metadata",
          processes: [
            {
              id: "process:app-wiring",
              pidHash: "pid:app-wiring",
              displayName: "UnrealEditor.exe",
              displayExecutableHash: "exe:app-wiring",
              displayProjectHint: "[project-root]/FinalHost.uproject",
              processState: "running",
              discoveredAt: 1,
              expiresAt: 9_999_999_999_999,
              source: "native",
            },
          ],
        } as T;
      }
      if (command === "attach_editor_process" || command === "read_editor_process_status") {
        return {
          sessionId: "editor-session:app-wiring",
          projectId: "project:app-wiring",
          rootId: "root:app-wiring",
          uprojectDisplayPath: "[project-root]/FinalHost.uproject",
          pidHash: "pid:app-wiring",
          mode: "attached",
          status: "attached",
          reason: command === "attach_editor_process" ? "attached" : "heartbeat_ok",
          createdAt: 1,
          expiresAt: 9_999_999_999_999,
          lastHeartbeatAt: 2,
          replayOnly: false,
        } as T;
      }
      if (command === "read_editor_observation_snapshot") {
        return {
          sessionId: "editor-session:app-wiring",
          editorState: "attached",
          sessionState: "active",
          projectMatched: true,
          processAlive: true,
          lastHeartbeatAt: 2,
          displayProject: "[project-root]/FinalHost.uproject",
          displayProcess: "UnrealEditor.exe",
          readOnlyDiagnostics: ["process metadata only"],
          createdAt: 3,
        } as T;
      }
      if (command === "mcp_streamable_http_request") {
        if (String(input.endpoint).includes("127.0.0.1:9")) {
          await harness.invoke("record_mcp_transport_failure", input);
          throw new Error("native_request_failed");
        }
        if (input.method === "DELETE") {
          return harness.invoke<T>("attach_mcp_transport_observation", {
            request: input,
            response: {
              method: "DELETE",
              status: 204,
              body: "",
              contentType: null,
              sessionId: null,
              protocolVersion: input.protocolVersion,
            },
          });
        }
        const request = JSON.parse(String(input.body ?? "{}")) as {
          id?: string | number;
          method?: string;
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        const intent = input.observation as { toolSearchMode?: string } | undefined;
        let sessionId = typeof input.sessionId === "string" ? input.sessionId : null;
        if (request.method === "initialize") {
          mcpSessionSequence += 1;
          sessionId = `native-mcp-session-${mcpSessionSequence.toString().padStart(4, "0")}`;
        }
        const toolName = request.method === "tools/call" ? request.params?.name : undefined;
        let result: unknown;
        if (request.method === "initialize") {
          result = {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "App Wiring MCP", version: "1.0.0" },
            capabilities: { tools: {}, resources: {}, prompts: {} },
          };
        } else if (request.method === "tools/list") {
          result = intent?.toolSearchMode === "on"
            ? {
                tools: ["list_toolsets", "describe_toolset", "call_tool"].map((name) => ({
                  name,
                  inputSchema: { type: "object" },
                })),
              }
            : { tools: evidence.descriptors };
        } else if (request.method === "resources/list") {
          result = { resources: [] };
        } else if (request.method === "prompts/list") {
          result = { prompts: [] };
        } else if (toolName === "list_toolsets") {
          result = {
            content: [
              { type: "text", text: JSON.stringify({ toolsets: [{ id: "UAgentAssetTools" }] }) },
            ],
          };
        } else if (toolName === "describe_toolset") {
          result = {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  toolset: {
                    toolsetId: "UAgentAssetTools",
                    methods: evidence.descriptors.map((descriptor, index) => ({
                      exactToolName: descriptor.name,
                      methodId: `asset-method-${index + 1}`,
                      schemaVersion: descriptor.schemaVersion,
                      inputSchema: descriptor.inputSchema,
                      dryRunSchema: descriptor.dryRunSchema,
                      rollbackContract: descriptor.rollbackContract,
                      affectedAssetsSchema: descriptor.affectedAssetsSchema,
                      evidenceQuery: descriptor.evidenceQuery,
                    })),
                  },
                }),
              },
            ],
          };
        } else {
          result = null;
        }
        return harness.invoke<T>("attach_mcp_transport_observation", {
          request: input,
          response: {
            method: "POST",
            status: 200,
            body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
            contentType: "application/json",
            sessionId,
            protocolVersion: "2025-06-18",
          },
        });
      }
      if (command === "attest_mvp15_companion") {
        const response = {
          status: "observed",
          reason: "native_loaded_modules_observed",
          manifest: evidence.manifest,
          installedModules: evidence.installedModules,
          loadedModules: evidence.loadedModules,
          nativeReceiptId: null,
        };
        const nativeReceiptId = await harness.invoke<string>("record_native_fixture_observation", {
          api: command,
          request: input,
          response,
        });
        return { ...response, nativeReceiptId } as T;
      }
      if (command === "retract_mvp15_companion_approvals") {
        const requestedAttestationGeneration =
          Number.isSafeInteger(input.attestationGeneration) && Number(input.attestationGeneration) > 0
            ? Number(input.attestationGeneration)
            : null;
        nativeGeneration += 1;
        const response = {
          status: "retracted",
          reason: "companion_approval_retracted",
          applied: true,
          requestedAttestationGeneration,
          minimumAttestationGeneration: requestedAttestationGeneration ?? 0,
          revokedApprovalCount: 0,
          generation: nativeGeneration,
          nativeReceiptId: null,
        };
        const nativeReceiptId = await harness.invoke<string>("record_native_fixture_observation", {
          api: command,
          request: input,
          response,
        });
        return { ...response, nativeReceiptId } as T;
      }
      throw new Error(`unexpected_app_wiring_command:${command}`);
    };
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });

    try {
      const [{ default: App }, { getFixedAppRuntimeAdapter }, { startMvp15dRuntimeBridge }] =
        await Promise.all([
          import("./App"),
          import("../runtime/runtime-store"),
          import("../runtime/mvp15d-runtime-bridge"),
        ]);
      render(<App />);
      expect(document.querySelector(".ua-app")).not.toBeNull();
      const registeredAdapter = getFixedAppRuntimeAdapter();
      expect(registeredAdapter).not.toBeNull();
      expect(registeredAdapter?.getMvp15dProductObservationPort?.()).toBeNull();
      await expect(startMvp15dRuntimeBridge(invoke)).resolves.toBeUndefined();
      expect(await harness.invoke<string[]>("lifecycle")).toEqual([
        "predecessor:request",
        "predecessor:request:returned",
        "parent:destroy:completed",
        "parent:build:succeeded",
        "parent:acknowledged",
      ]);
      cleanup();
      vi.resetModules();

      const [successorAppModule, successorStore, successorBridge] = await Promise.all([
        import("./App"),
        import("../runtime/runtime-store"),
        import("../runtime/mvp15d-runtime-bridge"),
      ]);
      render(<successorAppModule.default />);
      const successorAdapter = successorStore.getFixedAppRuntimeAdapter();
      expect(successorAdapter).not.toBeNull();
      expect(successorAdapter).not.toBe(registeredAdapter);
      expect(successorAdapter?.getMvp15dProductObservationPort?.()).toBeNull();
      await expect(successorBridge.startMvp15dRuntimeBridge(invoke)).resolves.toBeUndefined();

      expect(await harness.invoke<string[]>("lifecycle")).toEqual([
        "predecessor:request",
        "predecessor:request:returned",
        "parent:destroy:completed",
        "parent:build:succeeded",
        "parent:acknowledged",
        "successor:claim",
        "successor:publish",
        "successor:complete",
      ]);
      expect(commands.filter((command) => command === "mvp15d_bridge_claim_renderer_restart"))
        .toHaveLength(1);
      expect(commands.filter((command) => command === "mvp15d_bridge_publish_product_evidence"))
        .toHaveLength(1);
      expect(commands.filter((command) => command === "mvp15d_bridge_configuration")).toHaveLength(2);
      expect(commands.filter((command) => command === "mvp15d_bridge_take_driver_command")).toHaveLength(1);
      expect(commands.filter((command) => command === "mvp15d_bridge_complete")).toHaveLength(1);
    } finally {
      cleanup();
      vi.unstubAllGlobals();
      vi.resetModules();
      await harness.stop();
    }
  }, 120_000);

  it("keeps ordinary App startup and a disabled bridge without fixed authority", async () => {
    const commands: string[] = [];
    const invoke: NativeInvoke = async <T,>(command: string) => {
      commands.push(command);
      if (command === "mvp15d_bridge_configuration") {
        return {
          enabled: false,
          bridgeVersion: "uagent.mvp15d.runtime-bridge.v5",
          phase: "disabled",
          mode: "disabled",
          taskId: "",
          session: "",
          generation: 0,
          endpoint: null,
          projectRoot: null,
          renderedProductPath: "",
          driverPollMilliseconds: 1,
          observationTimeoutMilliseconds: 1_000,
          approvalTtlWaitMilliseconds: 1,
          receiptLedgerEnabled: false,
          rendererHandoffPending: false,
          rendererHandoffId: null,
          rendererParentLifecycleStatus: null,
          rendererParentLifecycleFailure: null,
        } as T;
      }
      throw new Error(`unexpected_disabled_bridge_command:${command}`);
    };
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });

    try {
      const [{ default: App }, { getFixedAppRuntimeAdapter }, { startMvp15dRuntimeBridge }] =
        await Promise.all([
          import("./App"),
          import("../runtime/runtime-store"),
          import("../runtime/mvp15d-runtime-bridge"),
        ]);
      render(<App />);
      const registeredAdapter = getFixedAppRuntimeAdapter();
      expect(registeredAdapter?.getMvp15dProductObservationPort?.()).toBeNull();
      expect(registeredAdapter?.getMvp15dUiObservationPort?.()).toBeNull();

      await expect(startMvp15dRuntimeBridge(invoke)).resolves.toBeUndefined();
      expect(registeredAdapter?.getMvp15dProductObservationPort?.()).toBeNull();
      expect(registeredAdapter?.getMvp15dUiObservationPort?.()).toBeNull();
      expect(commands.filter((command) => command === "mvp15d_bridge_configuration")).toHaveLength(1);
      expect(commands).not.toContain("mvp15d_bridge_observe_native_state");
    } finally {
      cleanup();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

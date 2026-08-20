import { AppShell } from "../shell/AppShell";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import { registerFixedAppRuntimeAdapter } from "../runtime/runtime-store";
import { UIProvider } from "./providers";

let fixedAppRuntimeAdapter: ReturnType<typeof createDesktopRuntimeAdapter> | null = null;

export function initializeFixedAppRuntimeAdapter() {
  if (!fixedAppRuntimeAdapter) {
    fixedAppRuntimeAdapter = createDesktopRuntimeAdapter();
    registerFixedAppRuntimeAdapter(fixedAppRuntimeAdapter);
  }
  return fixedAppRuntimeAdapter;
}

/**
 * UAgent desktop application root.
 *
 * Wraps the AppShell in the UI provider so all shell regions
 * can access shared UI state (inspector toggle, theme).
 */
export default function App() {
  const runtimeAdapter = initializeFixedAppRuntimeAdapter();
  return (
    <UIProvider runtimeClient={runtimeAdapter}>
      <AppShell />
    </UIProvider>
  );
}

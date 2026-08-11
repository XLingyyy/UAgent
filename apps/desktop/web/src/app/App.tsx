import { AppShell } from "../shell/AppShell";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import { registerFixedAppRuntimeAdapter } from "../runtime/runtime-store";
import { UIProvider } from "./providers";

const fixedAppRuntimeAdapter = createDesktopRuntimeAdapter();
registerFixedAppRuntimeAdapter(fixedAppRuntimeAdapter);

/**
 * UAgent desktop application root.
 *
 * Wraps the AppShell in the UI provider so all shell regions
 * can access shared UI state (inspector toggle, theme).
 */
export default function App() {
  return (
    <UIProvider runtimeClient={fixedAppRuntimeAdapter}>
      <AppShell />
    </UIProvider>
  );
}

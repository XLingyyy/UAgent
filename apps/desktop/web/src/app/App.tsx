import { AppShell } from "../shell/AppShell";
import { UIProvider } from "./providers";

/**
 * UAgent desktop application root.
 *
 * Wraps the AppShell in the UI provider so all shell regions
 * can access shared UI state (inspector toggle, theme).
 */
export default function App() {
  return (
    <UIProvider>
      <AppShell />
    </UIProvider>
  );
}

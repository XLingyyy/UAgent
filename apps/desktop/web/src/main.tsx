import {I18nProvider} from "./i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import App, { initializeFixedAppRuntimeAdapter } from "./app/App";
import { ACCEPTANCE_ENABLED } from "./runtime/build-capabilities";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/animations.css";
import "./styles/globals.css";
import "./styles/design-refresh.css";

initializeFixedAppRuntimeAdapter();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider><App /></I18nProvider>
  </React.StrictMode>,
);

if (ACCEPTANCE_ENABLED) {
  void import("./runtime/mvp15d-runtime-bridge").then(({ startMvp15dRuntimeBridgeFromApp }) => startMvp15dRuntimeBridgeFromApp());
}

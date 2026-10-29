import {initializeApplicationProfile} from "./runtime/application-profile";
import {I18nProvider} from "./i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import {ACCEPTANCE_ENABLED} from "./runtime/build-capabilities";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/animations.css";
import "./styles/globals.css";
import "./styles/design-refresh.css";

async function boot(){
 await initializeApplicationProfile();
 const {default:App,initializeFixedAppRuntimeAdapter}=await import("./app/App");
 initializeFixedAppRuntimeAdapter();
 ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><I18nProvider><App/></I18nProvider></React.StrictMode>);
 if(ACCEPTANCE_ENABLED){const {startMvp15dRuntimeBridgeFromApp}=await import("./runtime/mvp15d-runtime-bridge");await startMvp15dRuntimeBridgeFromApp();}
}
void boot().catch(()=>{const root=document.getElementById("root");if(root)root.textContent="启动失败：无法确认本地数据目录。请检查启动参数。 / Startup stopped: local profile could not be verified.";});

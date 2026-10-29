import {useI18n} from "../i18n";
import {useProjectStore,useRuntimeStore} from "../stores/ui-store";
import type {WorkspaceStatusItem} from "./workspace-data";
import "./WorkspaceStatusStrip.css";
export interface WorkspaceStatusStripProps {items?:WorkspaceStatusItem[]}
export function WorkspaceStatusStrip({items=[]}:WorkspaceStatusStripProps){
  const {text: uiText} = useI18n();
 const stateText=(value:string)=>uiText(({disconnected:"Not connected",connected:"Connected",unknown:"Unknown",not_indexed:"Not indexed",untrusted:"Not trusted",trusted:"Trusted",ready:"Ready",native:"Native",fixture:"Fixture",idle:"Idle",disabled:"Disabled"} as Record<string,string>)[value]??value);
 const project=useProjectStore(s=>s);const runtime=useRuntimeStore(s=>s);
 const active=project.registeredProjects.find(p=>p.id===project.activeProjectId);
 const status=[...items,{label:"MCP",value:runtime.mcp.status},{label:"Editor",value:runtime.mvp14.session?.status??"not connected"},{label:"Project index",value:project.activeProjectIndex?.status??"not indexed"},{label:"Active project",value:active?.name??"No project root registered"},{label:"Native source",value:project.nativeSource},{label:"Root trust",value:active?.trustState??"Not trusted"}];
 return <details className="ua-workspace-details"><summary>{uiText("Connection details")}{" "}<span>{uiText("MCP · UE · local workspace")}</span></summary><section className="ua-workspace-status" aria-label={uiText("Workspace status")}>{status.map(item=><div className="ua-workspace-status__item" key={item.label}><span className="ua-workspace-status__label">{uiText(item.label)}</span><span className="ua-workspace-status__value">{item.label === "Active project" && active ? item.value : stateText(item.value)}</span></div>)}</section></details>;
}

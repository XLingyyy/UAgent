import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import type {ProjectIndexSnapshot,SafeFilePreviewResult} from "@uagent/shared";
import {I18nProvider,createLocaleStore} from "../i18n";
import {ProjectSection} from "./ProjectSection";
const files=Array.from({length:35},(_,i)=>({id:String(i),rootRelativePath:`Source/File${i}.cpp`,displayName:`File${i}.cpp`,extension:".cpp",byteSize:10,isIgnored:false,limitReason:null}));
const snapshot={id:"index-a",projectId:"A",rootRef:"root:A",status:"ready",files:[...files,{...files[0],id:"config",rootRelativePath:"Config/Game.ini",extension:".ini"},{...files[0],id:"ignored",rootRelativePath:"Ignored.cpp",isIgnored:true}],assets:[],directories:[],summary:{scannedAt:1}} as unknown as ProjectIndexSnapshot;
const project={id:"A",name:"Synthetic",engineVersion:"5.8.4",connectionStatus:"trusted",path:"[project-root]"};
function view(index:ProjectIndexSnapshot=snapshot,preview:SafeFilePreviewResult|null=null){return <I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><ProjectSection mode="projects" project={project} activeProjectId="A" treeNodes={[]} indexSnapshot={index} onPreviewFile={read} selectedAssetPath="Source/File0.cpp" preview={preview}/></I18nProvider>;}
const read=vi.fn();afterEach(()=>{cleanup();read.mockClear();});
it("indexed source searches every index page and routes selection to existing native preview action",()=>{
 render(view());expect(screen.getByText("36 matching files; page 1 of 2")).toBeTruthy();expect(screen.queryByText("Ignored.cpp")).toBeNull();
 fireEvent.click(screen.getByText("Next files"));expect(screen.getByText("Source/File34.cpp")).toBeTruthy();
 fireEvent.change(screen.getByLabelText("Search file paths"),{target:{value:"config/GAME"}});expect(screen.getByText("1 matching files; page 1 of 1")).toBeTruthy();expect(read).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("Config/Game.ini"));expect(read).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledWith("Config/Game.ini");
});
it("indexed source extension filtering resets pagination and reports no matches",()=>{
 render(view());fireEvent.click(screen.getByText("Next files"));fireEvent.change(screen.getByLabelText("File extension"),{target:{value:".ini"}});expect(screen.getByText("1 matching files; page 1 of 1")).toBeTruthy();
 fireEvent.change(screen.getByLabelText("Search file paths"),{target:{value:"does-not-exist"}});expect(screen.getByText(/No indexed files match/)).toBeTruthy();expect((screen.getByText("Next files") as HTMLButtonElement).disabled).toBe(true);
});
it("indexed source refuses an index or file preview from another project",()=>{
 const preview={projectId:"B",rootRelativePath:"Source/File0.cpp",content:"OTHER_PROJECT_PRIVATE",status:"ready",redaction:{replacedSecrets:0,replacedPaths:0}} as SafeFilePreviewResult;
 render(view({...snapshot,projectId:"B"},preview));expect(screen.queryByLabelText("Search file paths")).toBeNull();expect(screen.queryByText("OTHER_PROJECT_PRIVATE")).toBeNull();
});
it("indexed source replacement index clears old filters and marks truncated excerpts",()=>{
 const preview={projectId:"A",rootRelativePath:"Source/File0.cpp",content:"int a;",status:"truncated",reason:"byte_limit",redaction:{replacedSecrets:0,replacedPaths:0}} as SafeFilePreviewResult;
 const h=render(view(snapshot,preview));fireEvent.change(screen.getByLabelText("Search file paths"),{target:{value:"old-query"}});
 h.rerender(view({...snapshot,id:"new-index"},preview));expect((screen.getByLabelText("Search file paths") as HTMLInputElement).value).toBe("");expect(screen.getByText("This is a bounded excerpt, not the complete file.")).toBeTruthy();
});

it("indexed source failed preview gives a retry message without old text",()=>{
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><ProjectSection mode="projects" project={project} treeNodes={[]} indexSnapshot={snapshot} selectedAssetPath="Source/File1.cpp" previewError="file_preview_failed" preview={{projectId:"A",rootRelativePath:"Source/File0.cpp",content:"STALE_TEXT"} as SafeFilePreviewResult}/></I18nProvider>);
 expect(screen.getByRole("alert").textContent).toContain("File reading failed");expect(screen.queryByText("STALE_TEXT")).toBeNull();
});

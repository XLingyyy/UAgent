import {afterEach,it,expect,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {BlueprintStructureReader} from "./BlueprintStructureReader";
afterEach(cleanup);
it("reports cold-load boundary for the exact selected package without fallback calls",async()=>{
 const invoke=vi.fn().mockRejectedValue("semantic_blueprint_cold_load_unsupported");
 const session={projectId:"root:synthetic-cold-project",rootId:"native-root",sessionId:"owned-editor"};
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><BlueprintStructureReader session={session} initialPackage="/Game/Characters/BP_Cold" invoke={invoke}/></I18nProvider>);
 fireEvent.click(screen.getByText("Confirm and read structure"));
 const error=await screen.findByRole("alert");expect(error.textContent).toContain("Guaranteed read-only cold loading is unsupported");expect(error.textContent).toContain("No load, save or automatic retry");
 expect(invoke.mock.calls).toEqual([["read_ue_blueprint_structure",{input:{projectId:session.projectId,rootId:session.rootId,editorSessionId:session.sessionId,packageName:"/Game/Characters/BP_Cold"}}]]);
});

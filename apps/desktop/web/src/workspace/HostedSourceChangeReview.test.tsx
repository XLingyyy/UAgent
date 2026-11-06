import {afterEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {HostedSourceChangeReview} from "./HostedSourceChangeReview";
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("../runtime/native-provider-budget",()=>({localNativeInvoke:()=>mocks.invoke}));
vi.mock("../i18n",()=>({useI18n:()=>({locale:"en"})}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const preview={nativePlanDigest:"exact-native-digest",preview:{files:[{path:"Source/Main.cpp",before:"int value = 1;",after:"int value = 2;"}]}};
it("requires diff review and binds approval to the selected native proposal without claiming a build",async()=>{
  mocks.invoke.mockImplementation(async(command:string)=>command==="hosted_source_change"?{preview,receipt:null}:{persisted:true,hostSettled:true,receipt:{status:"applied",effects:[{path:"Source/Main.cpp",status:"applied"}]},historyRunId:"write-run",buildValidated:false});
  render(<HostedSourceChangeReview runId="task-run" zh={false}/>);
  const apply=await screen.findByRole("button",{name:"Request approval to apply once"});
  expect((apply as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox",{name:"I reviewed these source changes"}));fireEvent.click(apply);
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("approve_hosted_source_change",{input:{runId:"task-run",digest:"exact-native-digest"}}));
  await screen.findByText(/Build and runtime validation have not run/);
  expect(screen.queryByRole("button",{name:"Request approval to apply once"})).toBeNull();
});
it("shows an uncertain write as unconfirmed and reloads its native receipt",async()=>{
  let attempted=false;
  mocks.invoke.mockImplementation(async(command:string)=>{
    if(command==="approve_hosted_source_change"){attempted=true;throw Error("unconfirmed");}
    return attempted?{preview:null,receipt:{error:"source_change_apply_or_persistence_unknown"}}:{preview,receipt:null};
  });
  render(<HostedSourceChangeReview runId="task-run" zh={false}/>);
  await screen.findByRole("button",{name:"Request approval to apply once"});
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button"));
  await screen.findByText("source_change_apply_or_persistence_unknown");
  expect(screen.queryByText(/Source changes applied/)).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

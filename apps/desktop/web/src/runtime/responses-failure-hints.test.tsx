import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,describe,expect,it} from "vitest";
import {responsesFailureHint,OPENAI_MODEL_DOCS} from "./responses-failure-hints";
import {I18nProvider,createLocaleStore} from "../i18n";
import {ConversationMessage} from "../workspace/ConversationMessage";
afterEach(cleanup);
describe("safe Responses failure guidance",()=>{
 it.each(["zh-CN","en"] as const)("explains exact snapshot matching and points to official documentation: %s",locale=>{
  const message={id:"failed",eventType:"provider_request_failed",kind:"review-summary" as const,label:"Provider failed",title:"Provider request failed",body:"Responses model differs from the explicitly selected model.",meta:"",timestamp:"00:00"};
  render(<I18nProvider store={createLocaleStore({initialLocale:locale,storage:null,eventTarget:null})}><ConversationMessage message={message}/></I18nProvider>);
  expect(screen.getByText(locale==="en"?/normal alias resolution/:/别名正常解析/)).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe(OPENAI_MODEL_DOCS);
 });
 it.each([400,401,403,429,503])("shows distinct bilingual action for HTTP %i with no remote interpolation",status=>{
  for(const locale of ["zh-CN","en"] as const){
   const hint=responsesFailureHint("Responses returned HTTP "+status+". No automatic retry was sent.",locale);
   expect(hint?.summary).toContain("HTTP "+status);
   expect(hint?.summary).toMatch(status===401||status===403?locale==="en"?/key/:/密钥/:status===429?locale==="en"?/quota or rate/:/额度或速率/:status>=500?locale==="en"?/temporarily unavailable/:/暂不可用/:locale==="en"?/snapshot ID/:/快照 ID/);
  }
 });
 it.each(["Responses returned HTTP 401. remote secret","Responses returned HTTP 401. No automatic retry was sent. secret","untrusted model id","Responses returned HTTP 302. No automatic retry was sent."])("never promotes arbitrary content to a trusted hint: %s",body=>{
  expect(responsesFailureHint(body,"zh-CN")).toBeNull();
 });
});

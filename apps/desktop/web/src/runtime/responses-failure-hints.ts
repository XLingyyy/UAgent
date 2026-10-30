import {translate,type Locale} from "../i18n";
export const OPENAI_MODEL_DOCS="https://developers.openai.com/api/docs/models";
/** Only fixed local errors are recognized. Never interpolate returned IDs, bodies or headers. */
export function responsesFailureHint(body:string,locale:Locale):{summary:string;modelDocs:boolean}|null{
 if(body==="Responses model differs from the explicitly selected model.")
  return {summary:translate(locale,"responses.modelMismatch"),modelDocs:true};
 const match=/^Responses returned HTTP ([45][0-9]{2})\. No automatic retry was sent\.$/.exec(body);
 if(!match)return null;
 const status=Number(match[1]);
 const key=status===401||status===403?"responses.httpAuth":status===429?"responses.httpLimit":
  status>=500?"responses.httpServer":"responses.httpRequest";
 return {summary:translate(locale,key,{status}),modelDocs:key==="responses.httpRequest"};
}

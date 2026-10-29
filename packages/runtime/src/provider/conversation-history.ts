import type {TaskDraft} from "@uagent/shared";
export const MAX_CONVERSATION_TURNS=8;
export const MAX_CONVERSATION_BYTES=12_288;
export function boundConversationHistory(history:NonNullable<TaskDraft["conversationHistory"]>){
 if(!Array.isArray(history)||history.length%2!==0||history.length>256)throw Error("invalid_conversation_history");
 for(let i=0;i<history.length;i+=2){if(history[i]?.role!=="user"||history[i+1]?.role!=="assistant"||typeof history[i].content!=="string"||typeof history[i+1].content!=="string")throw Error("invalid_conversation_history");}
 const selected:typeof history=[];let bytes=0;
 for(let i=history.length-2;i>=0&&selected.length<MAX_CONVERSATION_TURNS*2;i-=2){const pair=history.slice(i,i+2);const size=pair.reduce((n,m)=>n+new TextEncoder().encode(m.content).length,0);if(bytes+size>MAX_CONVERSATION_BYTES)break;selected.unshift(...pair.map(m=>({role:m.role,content:m.content})));bytes+=size;}
 return selected;
}

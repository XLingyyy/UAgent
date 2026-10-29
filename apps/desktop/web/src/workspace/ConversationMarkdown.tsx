import {Fragment,type ReactNode} from "react";
function inline(text:string):ReactNode[]{
 return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part,i)=>part.startsWith("`")&&part.endsWith("`")?<code key={i}>{part.slice(1,-1)}</code>:part.startsWith("**")&&part.endsWith("**")?<strong key={i}>{part.slice(2,-2)}</strong>:<Fragment key={i}>{part}</Fragment>);
}
/** React escapes all model content. No HTML execution or untrusted images. */
export function ConversationMarkdown({text}:{text:string}){
 const lines=text.split("\n"),blocks:ReactNode[]=[];let i=0;
 while(i<lines.length){const line=lines[i];if(line.startsWith("```")){const language=line.slice(3).trim();const code=[];i++;while(i<lines.length&&!lines[i].startsWith("```"))code.push(lines[i++]);if(i<lines.length)i++;blocks.push(<pre key={blocks.length}><code data-language={language}>{code.join("\n")}</code></pre>);continue;}
 if(!line.trim()){i++;continue;}
 if(/^[-*] /.test(line)){const items=[];while(i<lines.length&&/^[-*] /.test(lines[i]))items.push(<li key={i}>{inline(lines[i++].slice(2))}</li>);blocks.push(<ul key={blocks.length}>{items}</ul>);continue;}
 if(/^\d+\. /.test(line)){const items=[];while(i<lines.length&&/^\d+\. /.test(lines[i]))items.push(<li key={i}>{inline(lines[i++].replace(/^\d+\. /,""))}</li>);blocks.push(<ol key={blocks.length}>{items}</ol>);continue;}
 const heading=line.match(/^#{1,4} (.*)$/);if(heading){blocks.push(<h4 key={blocks.length}>{inline(heading[1])}</h4>);i++;continue;}
 const paragraph=[];while(i<lines.length&&lines[i].trim()&&!/^(```|[-*] |\d+\. |#{1,4} )/.test(lines[i]))paragraph.push(lines[i++]);blocks.push(<p key={blocks.length}>{inline(paragraph.join("\n"))}</p>);
 }
 return <div className="ua-chat-markdown">{blocks}</div>;
}

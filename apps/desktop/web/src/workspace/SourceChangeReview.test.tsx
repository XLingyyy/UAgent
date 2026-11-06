import {afterEach,expect,it} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {SourceChangeReview,sourceReplacementBlock} from "./SourceChangeReview";
afterEach(cleanup);
function show(before:string,after:string){return render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><SourceChangeReview before={before} after={after}/></I18nProvider>);}
it("isolates a middle insertion without falsely replacing its unchanged suffix",()=>{const b=sourceReplacementBlock("a\nb\n","a\ninsert\nb\n");expect(b).toEqual({prefix:1,suffix:1,removed:[],added:["insert\n"],identical:false});show("a\nb\n","a\ninsert\nb\n");expect(screen.getByRole("region",{name:"Replacement lines"}).textContent).toContain("+ 2 | insert ⟦LF⟧");});
it("shows pure deletion, including blank lines",()=>{const b=sourceReplacementBlock("a\n\nb\n","a\nb\n");expect(b.removed).toEqual(["\n"]);expect(b.added).toEqual([]);show("a\n\nb\n","a\nb\n");expect(screen.getByText("None (deletion)")).toBeTruthy();});
it("distinguishes CRLF, LF, bare CR and missing final newline",()=>{show("a\r\nb\rc","a\nb\rc\n");const old=screen.getByRole("region",{name:"Lines being replaced"}).textContent;expect(old).toContain("⟦CRLF⟧");expect(old).toContain("⟦CR⟧");expect(old).toContain("⟦no line ending⟧");expect(screen.getByRole("region",{name:"Replacement lines"}).textContent).toContain("+ 3 | c ⟦LF⟧");});
it("preserves a complete exact replacement across repeated lines, empty files and separate edits",()=>{
 for(const [before,after] of [["",""],["","\n"],["a", ""],["a\na\na\n","a\nx\na\n"],["old\nkeep\nold\n","new\nkeep\nnew\n"],["a\r\nb\rc\n","a\rb\r\nc"]]){
  const b=sourceReplacementBlock(before,after);const original=before.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)??[];
  expect(original.slice(0,b.prefix).join("")+b.added.join("")+original.slice(original.length-b.suffix).join("")).toBe(after);
 }
});
it("renders source markup as inert text and updates comparison when content changes",()=>{const h=show("<script>old</script>","<script>new</script>");expect(h.container.querySelector("script")).toBeNull();expect(screen.getByRole("region",{name:"Replacement lines"}).textContent).toContain("<script>new</script>");h.unmount();show("same","same");expect(screen.getByText("Contents are identical.")).toBeTruthy();});

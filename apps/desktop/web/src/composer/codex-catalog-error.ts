const hints:Record<string,[string,string]>={
 codex_program_directory_unavailable:["\u65e0\u6cd5\u9501\u5b9a Codex \u5b89\u88c5\u76ee\u5f55\u3002\u8bf7\u6838\u5bf9\u6240\u9009\u5b98\u65b9\u7a0b\u5e8f\u8def\u5f84\u3002","Could not pin the Codex installation directory. Check the selected official executable path."],
 codex_executable_unavailable:["\u65e0\u6cd5\u8bfb\u53d6\u6216\u9501\u5b9a codex.exe\u3002\u8bf7\u7b49\u5f85\u7a0b\u5e8f\u66f4\u65b0\u5b8c\u6210\u5e76\u6838\u5bf9\u8def\u5f84\u3002","Could not read or pin codex.exe. Check the path and wait for any update to finish."],
 codex_select_executable:["\u8bf7\u9009\u62e9 codex.exe \u7684\u5b8c\u6574\u672c\u5730\u8def\u5f84\u3002","Select the full local path to codex.exe."],
 codex_catalog_declined:["\u6a21\u578b\u5217\u8868\u8bfb\u53d6\u5df2\u53d6\u6d88\uff0c\u6216\u539f\u7a97\u53e3\u5df2\u5173\u95ed\u3002","Catalog approval was cancelled or its window closed."],
 codex_document_required:["\u5f53\u524d\u7a97\u53e3\u6388\u6743\u4e0d\u53ef\u7528\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00 UAgent\u3002","The current window authorization is unavailable. Reopen UAgent."],
 codex_start_failed:["Codex app-server \u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u6838\u5bf9\u5b89\u88c5\u4e0e\u8def\u5f84\u3002","Codex app-server could not start. Check its installation and path."],
 codex_job_failed:["Codex \u8fdb\u7a0b\u7ba1\u7406\u521d\u59cb\u5316\u5931\u8d25\u3002","Codex process ownership could not be established."],
 codex_reply_timeout:["Codex \u54cd\u5e94\u8d85\u65f6\u3002\u8bf7\u68c0\u67e5\u5b98\u65b9 Codex \u72b6\u6001\u540e\u518d\u8bfb\u53d6\u5217\u8868\u3002","Codex did not respond in time. Check official Codex before loading the catalog again."],
 codex_process_ended:["Codex \u5728\u8fd4\u56de\u5217\u8868\u524d\u9000\u51fa\u3002\u8bf7\u68c0\u67e5\u5b98\u65b9 Codex \u914d\u7f6e\u3002","Codex exited before returning the catalog. Check its official configuration."],
 codex_server_rejected_request:["Codex \u62d2\u7edd\u4e86\u5217\u8868\u8bf7\u6c42\uff0c\u8bf7\u68c0\u67e5\u5b98\u65b9 Codex \u72b6\u6001\u548c\u7248\u672c\u3002","Codex rejected the catalog request. Check its status and version."],
 codex_catalog_invalid:["Codex \u8fd4\u56de\u7684\u6a21\u578b\u76ee\u5f55\u683c\u5f0f\u4e0d\u517c\u5bb9\u3002","Codex returned an incompatible model catalog."],
 codex_catalog_failed:["\u6a21\u578b\u5217\u8868\u8bfb\u53d6\u5931\u8d25\uff0c\u53ef\u7528\u6027\u5c1a\u672a\u786e\u8ba4\u3002","Model catalog retrieval failed; availability remains unconfirmed."]
};
export function codexCatalogFailure(error:unknown,zh:boolean):string {
 const raw=typeof error==="string"?error:error instanceof Error?error.message:"";
 const candidate=raw.match(/\bcodex_[a-z_]+\b/)?.[0];
 const code=candidate&&Object.hasOwn(hints,candidate)?candidate:"codex_catalog_failed";
 return `${hints[code][zh?0:1]} (${code})`;
}

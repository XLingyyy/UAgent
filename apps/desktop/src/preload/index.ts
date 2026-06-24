import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("uagent", {
  platform: process.platform,
});

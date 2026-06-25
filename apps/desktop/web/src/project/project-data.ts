import type { MockProject } from "../types/ui";

export const DEFAULT_PROJECT_ID = "lyra";

export const MOCK_PROJECTS: MockProject[] = [
  {
    id: "lyra",
    name: "Lyra_Prototype",
    engineVersion: "UE 5.8",
    connectionStatus: "Not connected",
    path: "D:\\Unreal\\Lyra_Prototype",
  },
  {
    id: "mech",
    name: "MechArena_Testbed",
    engineVersion: "UE 5.8",
    connectionStatus: "Not connected",
    path: "D:\\Unreal\\MechArena_Testbed",
  },
  {
    id: "city",
    name: "CitySample_Sandbox",
    engineVersion: "UE 5.7",
    connectionStatus: "Not connected",
    path: "D:\\Unreal\\CitySample_Sandbox",
  },
];

import type { MockProject, MockThread } from "../types/ui";

export const mockProject: MockProject = {
  name: "Lyra_Prototype",
  engineVersion: "UE 5.8",
  connectionStatus: "Not connected",
  path: "D:\\Unreal\\Lyra_Prototype",
};

export const mockThreads: MockThread[] = [
  {
    id: "thread-1",
    title: "Initial project setup",
    type: "Plan",
    updatedAt: "2h ago",
  },
  {
    id: "thread-2",
    title: "Character blueprint refactor",
    type: "Build",
    updatedAt: "5h ago",
  },
  {
    id: "thread-3",
    title: "Physics asset review",
    type: "Review",
    updatedAt: "1d ago",
  },
];

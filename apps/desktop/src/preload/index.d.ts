export interface UAgentAPI {
  platform: string;
}

declare global {
  interface Window {
    uagent: UAgentAPI;
  }
}

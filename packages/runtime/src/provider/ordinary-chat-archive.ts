import type { ProviderUsage } from "@uagent/shared";
/** Data-only observer of one explicit ordinary request. Never an execution grant. */
export interface OrdinaryChatArchiveInput {
  requestId: string; conversationId: string; projectId: string | null;
  providerId: string; modelId: string;
  messages: Array<{ role: string; content: string }>;
}
export interface OrdinaryChatRequestArchive {
  append(text: string): Promise<void>;
  complete(text: string, usage: ProviderUsage): Promise<void>;
  fail(cancelled: boolean): Promise<void>;
}
export interface OrdinaryChatArchive {
  open(input: OrdinaryChatArchiveInput): Promise<OrdinaryChatRequestArchive>;
  close(): Promise<void>;
}

export type ApprovalRequestState = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  state: ApprovalRequestState;
  createdAt: number;
  resolvedAt: number | null;
}

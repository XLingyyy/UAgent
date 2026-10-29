/** Opt-in single-process scheduling; deliberately absent from the production runtime export. */
export { RunResourceQueue, ResourceQueueError } from "./resource-queue.js";
export type {
  ResourceKind,
  ResourceClaim,
  QueueOwner,
  ExecutionObservation,
  QueueStatus,
  QueueResult,
  QueueJobSnapshot,
  QueueClock,
  ResourceQueueOptions,
  QueueExecutionContext,
  QueueJob,
  QueueTicket,
} from "./resource-queue.js";

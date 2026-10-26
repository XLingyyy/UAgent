/** Monotonic across A -> B -> A; cancellation also invalidates outstanding work. */
export function createRequestGeneration() {
  let context = 0;
  const requests = new Map<string, number>();
  return {
    invalidate() { context += 1; },
    begin(lane: string) {
      const capturedContext = context;
      const request = (requests.get(lane) ?? 0) + 1;
      requests.set(lane, request);
      return () => capturedContext === context && requests.get(lane) === request;
    },
  };
}

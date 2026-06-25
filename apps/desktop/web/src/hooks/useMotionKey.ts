import { useEffect, useRef, useState } from "react";

/**
 * Returns a monotonically increasing key whenever the tracked
 * value changes so enter animations can be replayed.
 */
export function useMotionKey<T>(value: T) {
  const [motionKey, setMotionKey] = useState(0);
  const previousValueRef = useRef(value);

  useEffect(() => {
    if (Object.is(previousValueRef.current, value)) {
      return;
    }

    previousValueRef.current = value;
    setMotionKey((currentKey) => currentKey + 1);
  }, [value]);

  return motionKey;
}

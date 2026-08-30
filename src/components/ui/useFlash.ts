"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Returns `true` for `durationMs` after `value` changes (skipping the first
 * render). Used to briefly highlight a card/panel when live telemetry moves it.
 */
export function useFlash(value: unknown, durationMs = 600): boolean {
  const prev = useRef(value);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    setFlashing(true);
    const id = setTimeout(() => setFlashing(false), durationMs);
    return () => clearTimeout(id);
  }, [value, durationMs]);

  return flashing;
}

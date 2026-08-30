"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ControllerMode,
  IslandEvent,
  IslandState,
  NimbusDecision,
} from "@/types/nimbus";
import {
  advance,
  buildDecision,
  createInitialSnapshot,
  TICK_MS,
  toIslandState,
  withController,
  withEvent,
  type MockSnapshot,
} from "./nimbusMock";

export interface NimbusMock {
  state: IslandState;
  decision: NimbusDecision;
  activeEvent: IslandEvent | null;
  controller: ControllerMode;
  triggerEvent: (event: IslandEvent) => void;
  reset: () => void;
  setController: (controller: ControllerMode) => void;
}

/**
 * Phase 1 data source: a deterministic mock that ticks every {@link TICK_MS}.
 * Event buttons and the controller selector mutate local state only.
 */
export function useNimbusMock(): NimbusMock {
  const [snap, setSnap] = useState<MockSnapshot>(createInitialSnapshot);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSnap((prev) => advance(prev));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const triggerEvent = useCallback((event: IslandEvent) => {
    setSnap((prev) => withEvent(prev, event));
  }, []);

  const reset = useCallback(() => {
    setSnap((prev) => withEvent(prev, null));
  }, []);

  const setController = useCallback((controller: ControllerMode) => {
    setSnap((prev) => withController(prev, controller));
  }, []);

  const state = toIslandState(snap);
  const decision = buildDecision(state);

  return {
    state,
    decision,
    activeEvent: snap.event,
    controller: snap.controller,
    triggerEvent,
    reset,
    setController,
  };
}

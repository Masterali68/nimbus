"use client";

/**
 * useNimbusTelemetry — the single data source for the dashboard.
 *
 * Responsibilities:
 *   • open the telemetry WebSocket, keep it alive with backoff reconnects
 *   • bridge with REST polling while the socket is down
 *   • fall back to the deterministic mock engine when the backend is unreachable
 *     (only in "auto" mode)
 *   • keep a bounded chart history
 *   • track connection / loading / error state
 *   • run event / controller / reset commands with pending + error feedback
 *   • clean everything up on unmount
 *
 * The return value ({@link NimbusView}) is what every dashboard component reads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ControllerMode,
  IslandEvent,
  IslandState,
  NimbusDecision,
  TelemetrySample,
} from "@/types/nimbus";
import { apiConfig, HISTORY_LIMIT, POLL_INTERVAL_MS } from "@/lib/api/config";
import { SEVERITY_LABEL } from "@/lib/api/catalog";
import { normalizeDecision } from "@/lib/api/normalize";
import {
  checkHealth,
  connectTelemetryWebSocket,
  getCurrentState,
  getHistory,
  resetSimulation,
  selectController,
  triggerEvent as triggerEventRequest,
  type TelemetrySocket,
} from "@/lib/api/nimbusClient";
import type { ConnectionState, NimbusView } from "@/lib/api/types";
import {
  advance,
  buildDecision,
  createInitialSnapshot,
  TICK_MS,
  toIslandState,
  withController,
  withEvent,
  type MockSnapshot,
} from "@/lib/mock/nimbusMock";

const OFFLINE_AFTER_MS = 12_000;
const MAX_BACKOFF_MS = 8_000;
const COMMAND_RECONCILE_MS = 9_000;

function frameToSample(s: IslandState): TelemetrySample {
  return {
    t: s.timestamp,
    solarKw: s.energy.solarKw,
    windKw: s.energy.windKw,
    totalDemandKw: s.energy.totalDemandKw,
    netKw: s.energy.netKw,
    batteryPct: s.energy.batteryPct,
  };
}

function mergeHistory(
  existing: TelemetrySample[],
  incoming: TelemetrySample[],
): TelemetrySample[] {
  if (incoming.length === 0) return existing;
  const byT = new Map<number, TelemetrySample>();
  for (const s of existing) byT.set(s.t, s);
  for (const s of incoming) byT.set(s.t, s);
  return [...byT.values()].sort((a, b) => a.t - b.t).slice(-HISTORY_LIMIT);
}

export function useNimbusTelemetry(): NimbusView {
  const forcedMock = apiConfig.source === "mock";
  const allowMockFallback = apiConfig.source !== "live";

  // placeholder so the dashboard always has something to render (SSR-safe)
  const placeholder = useMemo(() => {
    const snap = createInitialSnapshot(null);
    return { state: toIslandState(snap), snap };
  }, []);

  const [source, setSource] = useState<"live" | "mock">(
    forcedMock ? "mock" : "live",
  );
  const [connection, setConnection] = useState<ConnectionState>(
    forcedMock ? "live" : "connecting",
  );
  const [loading, setLoading] = useState(!forcedMock);
  const [error, setError] = useState<string | null>(null);

  const [liveState, setLiveState] = useState<IslandState | null>(null);
  const [liveDecision, setLiveDecision] = useState<NimbusDecision | null>(null);
  const [history, setHistory] = useState<TelemetrySample[]>([]);
  const [mockState, setMockState] = useState<IslandState>(placeholder.state);

  const [pendingEvent, setPendingEvent] = useState<IslandEvent | "reset" | null>(
    null,
  );
  const [switchingController, setSwitchingController] =
    useState<ControllerMode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // optimistic command echoes (live mode) — cleared when telemetry catches up
  const [optimisticEvent, setOptimisticEvent] = useState<
    IslandEvent | null | undefined
  >(undefined);
  const [optimisticController, setOptimisticController] = useState<
    ControllerMode | undefined
  >(undefined);

  // ---- mutable transport bookkeeping ----
  const socketRef = useRef<TelemetrySocket | null>(null);
  const mockSnapRef = useRef<MockSnapshot>(placeholder.snap);
  const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  const gotFrameRef = useRef(false);
  const pollFailuresRef = useRef(0);
  const unmountedRef = useRef(false);
  const historyRef = useRef<TelemetrySample[]>([]);
  const liveStateRef = useRef<IslandState | null>(null);
  const retryTokenRef = useRef(0);
  const scheduleReconnectRef = useRef<() => void>(() => {});
  const restartRef = useRef<() => void>(() => {});
  const optimisticEventRef = useRef<IslandEvent | null | undefined>(undefined);
  const optimisticControllerRef = useRef<ControllerMode | undefined>(undefined);

  const applyHistory = useCallback((next: TelemetrySample[]) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const clearOfflineTimer = useCallback(() => {
    if (offlineTimerRef.current) {
      clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = null;
    }
  }, []);

  const clearRecheck = useCallback(() => {
    if (recheckTimerRef.current) {
      clearInterval(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
  }, []);

  const applyFrame = useCallback(
    (incomingState: IslandState, rawHistory?: TelemetrySample[]) => {
      if (unmountedRef.current) return;
      gotFrameRef.current = true;
      pollFailuresRef.current = 0;
      clearOfflineTimer();
      clearRecheck();
      liveStateRef.current = incomingState;
      setLiveState(incomingState);
      setLoading(false);
      setError(null);
      setConnection("live");
      setSource("live");

      // reconcile optimistic command echoes now that real telemetry landed
      if (
        optimisticEventRef.current !== undefined &&
        incomingState.activeEvent === optimisticEventRef.current
      ) {
        optimisticEventRef.current = undefined;
        setOptimisticEvent(undefined);
        setPendingEvent((p) => (p === "reset" ? p : null));
      }
      if (
        optimisticControllerRef.current !== undefined &&
        incomingState.controller === optimisticControllerRef.current
      ) {
        optimisticControllerRef.current = undefined;
        setOptimisticController(undefined);
        setSwitchingController(null);
      }

      const incoming =
        rawHistory && rawHistory.length > 0
          ? rawHistory
          : [frameToSample(incomingState)];
      applyHistory(mergeHistory(historyRef.current, incoming));
    },
    [applyHistory, clearOfflineTimer, clearRecheck],
  );

  // ---------- mock engine ----------
  const stopMockEngine = useCallback(() => {
    if (mockTimerRef.current) {
      clearInterval(mockTimerRef.current);
      mockTimerRef.current = null;
    }
  }, []);

  const startMockEngine = useCallback(
    (opts?: { fresh?: boolean; event?: IslandEvent | null }) => {
      stopMockEngine();
      if (opts?.fresh) {
        mockSnapRef.current = createInitialSnapshot(opts.event ?? null);
      }
      setSource("mock");
      setMockState(toIslandState(mockSnapRef.current));
      applyHistory(mockSnapRef.current.history.slice(-HISTORY_LIMIT));
      setLoading(false);
      mockTimerRef.current = setInterval(() => {
        mockSnapRef.current = advance(mockSnapRef.current);
        setMockState(toIslandState(mockSnapRef.current));
        applyHistory(mockSnapRef.current.history.slice(-HISTORY_LIMIT));
      }, TICK_MS);
    },
    [applyHistory, stopMockEngine],
  );

  // ---------- offline ----------
  const goOffline = useCallback(() => {
    if (unmountedRef.current) return;
    // stop the aggressive reconnect / poll storm and settle
    retryTokenRef.current += 1;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    clearOfflineTimer();

    setConnection("offline");
    setLoading(false);
    if (allowMockFallback) {
      setError("Backend unavailable — showing simulated data.");
      startMockEngine({ fresh: true, event: null });
    } else {
      setError("Backend unavailable.");
    }

    // quietly probe every 20s; recover automatically if the backend returns
    clearRecheck();
    recheckTimerRef.current = setInterval(() => {
      void checkHealth().then((ok) => {
        if (ok && !unmountedRef.current) restartRef.current();
      });
    }, 20_000);
  }, [allowMockFallback, clearOfflineTimer, clearRecheck, startMockEngine]);

  // ---------- REST polling bridge ----------
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollOnce = useCallback(async () => {
    try {
      const [nextState, hist] = await Promise.all([
        getCurrentState(),
        getHistory(),
      ]);
      if (unmountedRef.current) return;
      applyFrame(nextState, hist);
    } catch {
      pollFailuresRef.current += 1;
      if (
        pollFailuresRef.current >= 3 &&
        !gotFrameRef.current &&
        !unmountedRef.current
      ) {
        goOffline();
      }
    }
  }, [applyFrame, goOffline]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    void pollOnce();
    pollTimerRef.current = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  }, [pollOnce]);

  // ---------- WebSocket ----------
  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const openSocket = useCallback(() => {
    const myToken = retryTokenRef.current;
    socketRef.current?.close();
    socketRef.current = connectTelemetryWebSocket({
      onState: (nextState) => {
        if (retryTokenRef.current !== myToken) return;
        stopPolling();
        stopMockEngine();
        attemptRef.current = 0;
        applyFrame(nextState);
      },
      onDecision: (raw) => {
        if (retryTokenRef.current !== myToken) return;
        const base =
          liveStateRef.current ?? toIslandState(mockSnapRef.current);
        setLiveDecision(normalizeDecision(raw, base));
      },
      onAck: (type) => {
        if (retryTokenRef.current !== myToken) return;
        if (type === "event_ack" || type === "reset_ack") setPendingEvent(null);
        if (type === "controller_ack") setSwitchingController(null);
      },
      onOpen: () => {
        if (retryTokenRef.current !== myToken) return;
        setError(null);
      },
      onClose: (clean) => {
        if (clean || retryTokenRef.current !== myToken || unmountedRef.current) {
          return;
        }
        scheduleReconnectRef.current();
      },
      onError: () => {
        /* onClose follows */
      },
    });
  }, [applyFrame, stopMockEngine, stopPolling]);

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    setConnection(gotFrameRef.current ? "reconnecting" : "connecting");
    startPolling();

    if (!gotFrameRef.current && !offlineTimerRef.current) {
      offlineTimerRef.current = setTimeout(() => {
        if (!gotFrameRef.current) goOffline();
      }, OFFLINE_AFTER_MS);
    }

    const delay = Math.min(1000 * 2 ** attemptRef.current, MAX_BACKOFF_MS);
    attemptRef.current += 1;
    clearReconnect();
    reconnectTimerRef.current = setTimeout(() => openSocket(), delay);
  }, [clearReconnect, goOffline, openSocket, startPolling]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  const startLive = useCallback(() => {
    retryTokenRef.current += 1;
    attemptRef.current = 0;
    gotFrameRef.current = false;
    pollFailuresRef.current = 0;
    clearRecheck();
    setConnection("connecting");
    setLoading(true);
    setError(null);
    setSource("live");
    stopMockEngine();
    startPolling(); // warm up fast while the socket connects
    openSocket();

    clearOfflineTimer();
    offlineTimerRef.current = setTimeout(() => {
      if (!gotFrameRef.current) goOffline();
    }, OFFLINE_AFTER_MS);
  }, [
    clearOfflineTimer,
    clearRecheck,
    goOffline,
    openSocket,
    startPolling,
    stopMockEngine,
  ]);

  useEffect(() => {
    restartRef.current = startLive;
  }, [startLive]);

  // ---------- lifecycle ----------
  useEffect(() => {
    unmountedRef.current = false;
    // Defer the initial connect one macrotask so the effect body itself does no
    // synchronous state updates (and StrictMode's double-invoke can't race).
    const boot = setTimeout(() => {
      if (unmountedRef.current) return;
      if (forcedMock) {
        startMockEngine({ fresh: true, event: null });
      } else {
        startLive();
      }
    }, 0);
    return () => {
      unmountedRef.current = true;
      retryTokenRef.current += 1;
      clearTimeout(boot);
      socketRef.current?.close();
      socketRef.current = null;
      stopMockEngine();
      stopPolling();
      clearReconnect();
      clearOfflineTimer();
      clearRecheck();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- commands ----------
  const runCommand = useCallback(
    async (fn: () => Promise<void>, onDone: () => void, label: string) => {
      setActionError(null);
      try {
        await fn();
        onDone();
      } catch {
        setActionError(`${label} failed — backend not reachable.`);
        setPendingEvent(null);
        setSwitchingController(null);
      }
    },
    [],
  );

  const triggerEvent = useCallback(
    (event: IslandEvent) => {
      setActionError(null);
      if (source === "mock") {
        setPendingEvent(event);
        mockSnapRef.current = withEvent(mockSnapRef.current, event);
        setMockState(toIslandState(mockSnapRef.current));
        setTimeout(() => setPendingEvent(null), 350);
        return;
      }
      setPendingEvent(event);
      setOptimisticEvent(event);
      optimisticEventRef.current = event;
      setTimeout(() => {
        optimisticEventRef.current = undefined;
        setOptimisticEvent(undefined);
      }, COMMAND_RECONCILE_MS);
      void runCommand(
        () => triggerEventRequest(event),
        () => setPendingEvent((p) => (p === event ? null : p)),
        "Event request",
      );
    },
    [runCommand, source],
  );

  const setControllerCb = useCallback(
    (mode: ControllerMode) => {
      setActionError(null);
      if (source === "mock") {
        setSwitchingController(mode);
        mockSnapRef.current = withController(mockSnapRef.current, mode);
        setMockState(toIslandState(mockSnapRef.current));
        setTimeout(() => setSwitchingController(null), 350);
        return;
      }
      setSwitchingController(mode);
      setOptimisticController(mode);
      optimisticControllerRef.current = mode;
      setTimeout(() => {
        optimisticControllerRef.current = undefined;
        setOptimisticController(undefined);
        setSwitchingController((s) => (s === mode ? null : s));
      }, COMMAND_RECONCILE_MS);
      void runCommand(
        () => selectController(mode),
        () => {
          /* cleared when a frame with the new controller arrives */
        },
        "Controller switch",
      );
    },
    [runCommand, source],
  );

  const reset = useCallback(() => {
    setActionError(null);
    applyHistory([]);
    if (source === "mock") {
      setPendingEvent("reset");
      mockSnapRef.current = withEvent(createInitialSnapshot(null), null);
      setMockState(toIslandState(mockSnapRef.current));
      setTimeout(() => setPendingEvent(null), 350);
      return;
    }
    setPendingEvent("reset");
    setOptimisticEvent(null);
    optimisticEventRef.current = null;
    setLiveDecision(null);
    setTimeout(() => {
      optimisticEventRef.current = undefined;
      setOptimisticEvent(undefined);
    }, COMMAND_RECONCILE_MS);
    void runCommand(
      resetSimulation,
      () => setPendingEvent((p) => (p === "reset" ? null : p)),
      "Reset",
    );
  }, [applyHistory, runCommand, source]);

  const retry = useCallback(() => {
    if (forcedMock) {
      startMockEngine({ fresh: true, event: null });
      return;
    }
    clearOfflineTimer();
    startLive();
  }, [clearOfflineTimer, forcedMock, startLive, startMockEngine]);

  // ---------- assemble the view ----------
  const baseState =
    source === "mock" ? mockState : liveState ?? placeholder.state;

  const state: IslandState = useMemo(() => {
    if (source === "mock") return baseState;
    const activeEvent =
      optimisticEvent !== undefined ? optimisticEvent : baseState.activeEvent;
    const controller = optimisticController ?? baseState.controller;
    return { ...baseState, activeEvent, controller, history };
  }, [baseState, source, optimisticEvent, optimisticController, history]);

  const decision: NimbusDecision = useMemo(() => {
    if (source === "live" && liveDecision) return liveDecision;
    return buildDecision(state);
  }, [source, liveDecision, state]);

  const severityLabel = SEVERITY_LABEL[state.status];

  return {
    state,
    decision,
    severityLabel,
    connection,
    source,
    loading,
    error,
    pendingEvent,
    switchingController,
    actionError,
    triggerEvent,
    setController: setControllerCb,
    reset,
    retry,
  };
}

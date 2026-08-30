/**
 * Centralised FastAPI client.
 *
 * Every backend call in the app goes through here. Nothing else imports URLs or
 * calls `fetch` / `WebSocket` directly.
 */

import type {
  ControllerMode,
  IslandEvent,
  IslandState,
  NimbusDecision,
  TelemetrySample,
} from "@/types/nimbus";
import { apiConfig, apiUrl, endpoints, REQUEST_TIMEOUT_MS } from "./config";
import { normalizeDecision, normalizeHistory, normalizeIslandState } from "./normalize";
import type { RawDecision, RawIslandState, RawSample, WsMessage } from "./types";

export class BackendError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "BackendError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init?.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  try {
    const res = await fetch(apiUrl(path), {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new BackendError(`${path} responded ${res.status}`);
    }
    // Some command endpoints reply with an empty body.
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (err) {
    if (err instanceof BackendError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new BackendError(`${path} timed out`);
    }
    throw new BackendError(`Could not reach backend (${path})`, err);
  } finally {
    clearTimeout(timeout);
  }
}

/** Latest full telemetry frame. */
export async function getCurrentState(): Promise<IslandState> {
  const raw = await request<RawIslandState>(endpoints.state);
  return normalizeIslandState(raw);
}

/** Latest decision. Falls back to deriving one from state if there is no endpoint. */
export async function getDecision(state: IslandState): Promise<NimbusDecision> {
  try {
    const raw = await request<RawDecision>(endpoints.decision);
    return normalizeDecision(raw, state);
  } catch {
    return normalizeDecision({}, state);
  }
}

/** Bounded chart history. */
export async function getHistory(): Promise<TelemetrySample[]> {
  try {
    const raw = await request<RawSample[] | { history?: RawSample[] }>(endpoints.history);
    const list = Array.isArray(raw) ? raw : raw.history;
    return normalizeHistory(list);
  } catch {
    return [];
  }
}

export async function triggerEvent(eventName: IslandEvent): Promise<void> {
  await request(endpoints.event, {
    method: "POST",
    body: JSON.stringify({ event: eventName }),
  });
}

export async function selectController(controllerMode: ControllerMode): Promise<void> {
  await request(endpoints.controller, {
    method: "POST",
    body: JSON.stringify({ controller: controllerMode }),
  });
}

export async function resetSimulation(): Promise<void> {
  await request(endpoints.reset, { method: "POST", body: JSON.stringify({}) });
}

export async function checkHealth(): Promise<boolean> {
  try {
    await request(endpoints.health, { timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}

export interface TelemetrySocketHandlers {
  onState?: (state: IslandState) => void;
  onRawFrame?: (raw: RawIslandState) => void;
  onDecision?: (raw: RawDecision) => void;
  onAck?: (type: string, payload: unknown) => void;
  onOpen?: () => void;
  onClose?: (clean: boolean) => void;
  onError?: (err: unknown) => void;
}

export interface TelemetrySocket {
  close: () => void;
}

/**
 * Open the telemetry WebSocket. Accepts either bare telemetry frames or a
 * `{ type, payload }` envelope. Returns a handle whose `close()` suppresses the
 * `onClose` callback so callers can distinguish a deliberate teardown.
 */
export function connectTelemetryWebSocket(
  handlers: TelemetrySocketHandlers,
): TelemetrySocket {
  let closedByCaller = false;
  let ws: WebSocket | null = null;

  try {
    ws = new WebSocket(apiConfig.wsUrl);
  } catch (err) {
    handlers.onError?.(err);
    handlers.onClose?.(false);
    return { close: () => {} };
  }

  ws.onopen = () => handlers.onOpen?.();

  ws.onmessage = (ev) => {
    let msg: WsMessage | RawIslandState;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    const type = (msg as WsMessage).type;
    const payload = (msg as WsMessage).payload ?? (msg as Record<string, unknown>);

    if (type === "decision") {
      handlers.onDecision?.(payload as RawDecision);
      return;
    }
    if (type && type.endsWith("_ack")) {
      handlers.onAck?.(type, payload);
      return;
    }
    if (type === "error") {
      handlers.onError?.(payload);
      return;
    }
    // telemetry / state / no envelope
    const raw = payload as RawIslandState;
    handlers.onRawFrame?.(raw);
    handlers.onState?.(normalizeIslandState(raw));
    if (raw.decision) handlers.onDecision?.(raw.decision);
  };

  ws.onerror = (err) => handlers.onError?.(err);
  ws.onclose = () => handlers.onClose?.(closedByCaller);

  return {
    close: () => {
      closedByCaller = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

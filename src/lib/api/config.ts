/**
 * Centralised backend configuration.
 *
 * All FastAPI URLs come from environment variables so nothing is hardcoded in
 * UI components. Defaults target a local FastAPI dev server.
 *
 *   NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
 *   NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/telemetry
 *   NEXT_PUBLIC_NIMBUS_SOURCE=auto | live | mock   (optional, default "auto")
 *
 * `auto`  – try the live backend, fall back to the local mock if unreachable.
 * `live`  – live backend only (still shows offline UI if it never connects).
 * `mock`  – never touch the network; run the deterministic mock engine.
 */

export type NimbusSource = "auto" | "live" | "mock";

const DEFAULT_API_BASE_URL = "http://localhost:8000";
const DEFAULT_WS_URL = "ws://localhost:8000/ws/telemetry";

function readSource(): NimbusSource {
  const raw = (process.env.NEXT_PUBLIC_NIMBUS_SOURCE ?? "").toLowerCase();
  if (raw === "live" || raw === "mock" || raw === "auto") return raw;
  return "auto";
}

export const apiConfig = {
  baseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, ""),
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? DEFAULT_WS_URL,
  source: readSource(),
} as const;

/**
 * REST endpoint paths, kept in one place for easy reconciliation with Vishruth.
 * Override the whole base with NEXT_PUBLIC_API_BASE_URL; these suffixes are the
 * frontend's current assumption and may need to change to match FastAPI.
 */
export const endpoints = {
  state: "/state",
  decision: "/decision",
  history: "/history",
  event: "/event",
  controller: "/controller",
  reset: "/reset",
  health: "/health",
} as const;

export function apiUrl(path: string): string {
  return `${apiConfig.baseUrl}${path}`;
}

/** How many chart samples to retain in memory. Bounded to keep the SVG cheap. */
export const HISTORY_LIMIT = 48;

/** Poll cadence for the REST fallback (ms). Matches the mock tick. */
export const POLL_INTERVAL_MS = 2000;

/** Per-request timeout for command calls (ms). */
export const REQUEST_TIMEOUT_MS = 6000;

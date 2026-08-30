// The ONLY file in the simulation module allowed to touch real-time/browser
// globals (setInterval/Date.now). The engine itself stays pull-based and
// interval-free so it's synchronously testable; this is the thin wrapper
// that drives it in real time for a client-side UI.

export interface AutoTickableEngine {
  tick(n?: number): unknown;
  getTickRate(): number;
}

export interface AutoTickController {
  /** speedMultiplier = simulated minutes advanced per real second. */
  start(speedMultiplier?: number): void;
  stop(): void;
  setSpeed(speedMultiplier: number): void;
  isRunning(): boolean;
}

const FRAME_MS = 100;

export function createAutoTick(engine: AutoTickableEngine): AutoTickController {
  let speedMultiplier = 1;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let lastRealMs: number | null = null;
  let fractionalTicksCarry = 0;

  function frame(): void {
    const now = Date.now();
    const elapsedMs = lastRealMs === null ? FRAME_MS : now - lastRealMs;
    lastRealMs = now;

    const tickLengthMinutes = engine.getTickRate();
    const simMinutesElapsed = (elapsedMs / 1000) * speedMultiplier;
    fractionalTicksCarry += simMinutesElapsed / tickLengthMinutes;

    const wholeTicks = Math.floor(fractionalTicksCarry);
    if (wholeTicks > 0) {
      engine.tick(wholeTicks);
      fractionalTicksCarry -= wholeTicks;
    }
  }

  return {
    start(multiplier = speedMultiplier) {
      speedMultiplier = multiplier;
      if (intervalHandle !== null) return;
      lastRealMs = null;
      fractionalTicksCarry = 0;
      intervalHandle = setInterval(frame, FRAME_MS);
    },
    stop() {
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
    setSpeed(multiplier: number) {
      speedMultiplier = multiplier;
    },
    isRunning() {
      return intervalHandle !== null;
    },
  };
}

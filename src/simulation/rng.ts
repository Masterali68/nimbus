// Deterministic PRNG backbone for the simulation engine.
//
// Every noise source (solar cloud cover, wind speed, each demand consumer,
// the event scheduler, the compound-crisis correlator) gets its own
// independent sub-stream derived from the master seed. This means adding a
// new noise source later can never perturb the sequence any existing stream
// produces — determinism is preserved per-stream, not just globally.

export type Rng = () => number; // uniform [0, 1)

/** mulberry32: tiny, single-integer-state, deterministic PRNG (not cryptographic). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a-style string hash, used to derive a distinct sub-seed per named stream. */
export function hashSeedLabel(seed: number, label: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 2654435761);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Creates an independent, deterministic RNG stream for a named noise source. */
export function createStream(seed: number, label: string): Rng {
  return mulberry32(hashSeedLabel(seed, label));
}

/** Derives a numeric seed from a human-readable string (for named demo scenarios). */
export function stringToSeed(s: string): number {
  return hashSeedLabel(0, s);
}

/** Standard normal sample via Box-Muller, stateless (no cached "spare" value to snapshot). */
export function sampleStandardNormal(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One step of a mean-reverting (Ornstein-Uhlenbeck) random walk:
 *   x_{t+1} = x_t + theta * (mu - x_t) + sigma * standardNormal()
 * Used for wind speed and cloud cover so noise is correlated tick-to-tick
 * rather than independently rolled each tick.
 */
export function stepOrnsteinUhlenbeck(
  x: number,
  mu: number,
  theta: number,
  sigma: number,
  rng: Rng
): number {
  return x + theta * (mu - x) + sigma * sampleStandardNormal(rng);
}

/** Named RNG streams the engine constructs once from the master seed. */
export interface RngStreams {
  solarCloud: Rng;
  windSpeed: Rng;
  demandHospital: Rng;
  demandDesalination: Rng;
  demandResidential: Rng;
  demandResort: Rng;
  eventsScheduler: Rng;
  eventsCompound: Rng;
}

export function createRngStreams(seed: number): RngStreams {
  return {
    solarCloud: createStream(seed, "solar.cloud"),
    windSpeed: createStream(seed, "wind.speed"),
    demandHospital: createStream(seed, "demand.hospital"),
    demandDesalination: createStream(seed, "demand.desalination"),
    demandResidential: createStream(seed, "demand.residential"),
    demandResort: createStream(seed, "demand.resort"),
    eventsScheduler: createStream(seed, "events.scheduler"),
    eventsCompound: createStream(seed, "events.compound"),
  };
}

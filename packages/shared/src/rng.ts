/**
 * The engine never reaches for a randomness source of its own: every shuffle and
 * every sampled hand comes through an injected `Rng`. Production wires this to
 * `crypto.randomInt` in the server; tests and AI rollouts wire it to a seeded PRNG
 * so a failing case can be replayed exactly.
 */
export type Rng = {
  /** Uniform integer in `[0, maxExclusive)`. `maxExclusive` must be >= 1. */
  int(maxExclusive: number): number;
};

/** Seeded, deterministic PRNG (mulberry32). Not cryptographic -- tests and simulations only. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
      }
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(unit * maxExclusive);
    },
  };
}

/** Fisher-Yates. Returns a new array; the input is left untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new RangeError('cannot pick from an empty array');
  return items[rng.int(items.length)]!;
}

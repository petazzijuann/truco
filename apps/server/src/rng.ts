import { randomInt } from 'node:crypto';
import type { Rng } from '@truco/shared';

/**
 * The production randomness source: `crypto.randomInt`, never `Math.random`.
 *
 * The shuffle decides the whole hand, so it has to be unpredictable rather than
 * merely uniform -- a seedable PRNG would let anyone who recovered the seed read
 * both hands in advance.
 */
export const cryptoRng: Rng = {
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return randomInt(maxExclusive);
  },
};

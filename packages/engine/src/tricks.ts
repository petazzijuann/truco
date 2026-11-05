import { type Card, type PlayerId, type TrickOutcome } from '@truco/shared';
import { compareStrength } from './hierarchy.js';

export type Play = { readonly player: PlayerId; readonly card: Card };

/** Who won a completed trick, or `'parda'` when the two cards are of equal rank. */
export function trickOutcome(plays: readonly Play[]): TrickOutcome {
  const [a, b] = plays;
  if (a === undefined || b === undefined) {
    throw new Error(`a trick needs two plays, got ${plays.length}`);
  }
  const cmp = compareStrength(a.card, b.card);
  if (cmp === 0) return 'parda';
  return cmp > 0 ? a.player : b.player;
}

/**
 * Who wins the hand, or `null` while it is still undecided.
 *
 * Two of three tricks wins, with the "parda" rules layered on top:
 *  - first trick tied: whoever takes the second wins; if that ties too, the third;
 *    all three tied goes to the mano.
 *  - won the first and tied the second: the first-trick winner takes the hand.
 *  - one trick each and the third tied: the first-trick winner takes the hand.
 */
export function resolveHandWinner(
  outcomes: readonly TrickOutcome[],
  mano: PlayerId,
): PlayerId | null {
  const [first, second, third] = outcomes;
  if (first === undefined) return null;

  if (first === 'parda') {
    if (second === undefined) return null;
    if (second !== 'parda') return second;
    if (third === undefined) return null;
    return third === 'parda' ? mano : third;
  }

  if (second === undefined) return null;
  // Won the first and either won or tied the second.
  if (second === 'parda' || second === first) return first;

  // One each: the third decides, and a tie there favours the first-trick winner.
  if (third === undefined) return null;
  return third === 'parda' ? first : third;
}

/** Who leads the next trick. After a parda the hand's mano leads again. */
export function nextLeader(outcome: TrickOutcome, mano: PlayerId): PlayerId {
  return outcome === 'parda' ? mano : outcome;
}

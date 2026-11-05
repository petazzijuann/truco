import { describe, expect, it } from 'vitest';
import { DECK_SIZE, FULL_DECK, cardId, seededRng, shuffle } from '@truco/shared';
import { CARDS_PER_HAND, deal, shuffledDeck } from './deck.js';

describe('deck', () => {
  it('has 40 cards with no 8s and no 9s', () => {
    expect(FULL_DECK).toHaveLength(DECK_SIZE);
    const ids = FULL_DECK.map(cardId);
    expect(new Set(ids).size).toBe(DECK_SIZE);
    expect(ids.some((id) => id.startsWith('8-') || id.startsWith('9-'))).toBe(false);
  });

  it('shuffles into a permutation of the full deck', () => {
    const deck = shuffledDeck(seededRng(7));
    expect(deck.map(cardId).sort()).toEqual(FULL_DECK.map(cardId).sort());
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    expect(shuffledDeck(seededRng(1)).map(cardId)).toEqual(shuffledDeck(seededRng(1)).map(cardId));
    expect(shuffledDeck(seededRng(1)).map(cardId)).not.toEqual(
      shuffledDeck(seededRng(2)).map(cardId),
    );
  });

  it('does not mutate the source deck', () => {
    const before = FULL_DECK.map(cardId);
    shuffle(FULL_DECK, seededRng(3));
    expect(FULL_DECK.map(cardId)).toEqual(before);
  });

  it('deals three cards each and keeps the remainder', () => {
    const { first, second, rest } = deal(seededRng(42));
    expect(first).toHaveLength(CARDS_PER_HAND);
    expect(second).toHaveLength(CARDS_PER_HAND);
    expect(rest).toHaveLength(DECK_SIZE - CARDS_PER_HAND * 2);
    const all = [...first, ...second, ...rest].map(cardId);
    expect(new Set(all).size).toBe(DECK_SIZE);
  });

  it('rejects a non-positive range', () => {
    expect(() => seededRng(1).int(0)).toThrow(RangeError);
    expect(() => seededRng(1).int(1.5)).toThrow(RangeError);
  });

  it('produces a roughly uniform distribution', () => {
    const rng = seededRng(99);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 40_000; i++) counts[rng.int(4)]!++;
    for (const count of counts) expect(count).toBeGreaterThan(9_000);
  });
});

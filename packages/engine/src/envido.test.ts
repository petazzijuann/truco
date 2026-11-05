import { describe, expect, it } from 'vitest';
import { cardId, type Card } from '@truco/shared';
import {
  MAX_ENVIDO,
  envidoBreakdown,
  envidoCardValue,
  envidoPoints,
  florPoints,
  florSuit,
  hasFlor,
} from './envido.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('envidoCardValue', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 7],
    [10, 0],
    [11, 0],
    [12, 0],
  ] as const)('a %i is worth %i', (rank, value) => {
    expect(envidoCardValue(c(rank, 'oro'))).toBe(value);
  });
});

describe('envidoPoints', () => {
  it('33 is the maximum: 7 and 6 of the same suit', () => {
    expect(envidoPoints([c(7, 'oro'), c(6, 'oro'), c(1, 'basto')])).toBe(MAX_ENVIDO);
    expect(MAX_ENVIDO).toBe(33);
  });

  it('two figures of the same suit are 20', () => {
    expect(envidoPoints([c(11, 'copa'), c(12, 'copa'), c(5, 'basto')])).toBe(20);
  });

  it('takes the two highest when all three share a suit', () => {
    // 5 + 2 + 20 = 27, ignoring the 1.
    expect(envidoPoints([c(5, 'espada'), c(2, 'espada'), c(1, 'espada')])).toBe(27);
    // 7 + 6 + 20 = 33, ignoring the 4.
    expect(envidoPoints([c(4, 'copa'), c(7, 'copa'), c(6, 'copa')])).toBe(33);
  });

  it('a figure in the pair contributes nothing', () => {
    expect(envidoPoints([c(7, 'oro'), c(12, 'oro'), c(3, 'basto')])).toBe(27);
  });

  it('with no repeated suit it is just the highest card', () => {
    expect(envidoPoints([c(7, 'oro'), c(5, 'basto'), c(3, 'copa')])).toBe(7);
    expect(envidoPoints([c(1, 'oro'), c(2, 'basto'), c(6, 'copa')])).toBe(6);
  });

  it('three loose figures are 0', () => {
    expect(envidoPoints([c(10, 'oro'), c(11, 'basto'), c(12, 'copa')])).toBe(0);
  });

  it('picks the better suit when two pairs are possible', () => {
    // 7+6 of oro (33) beats 3+2 of copa (25).
    expect(envidoPoints([c(7, 'oro'), c(6, 'oro'), c(3, 'copa')])).toBe(33);
  });

  it('is 0 for no cards', () => {
    expect(envidoPoints([])).toBe(0);
  });

  it('handles a single card', () => {
    expect(envidoPoints([c(6, 'oro')])).toBe(6);
    expect(envidoPoints([c(11, 'oro')])).toBe(0);
  });
});

describe('envidoBreakdown', () => {
  it('names only the cards that justify the count', () => {
    const result = envidoBreakdown([c(7, 'oro'), c(6, 'oro'), c(1, 'basto')]);
    expect(result.points).toBe(33);
    expect(result.cards.map(cardId).sort()).toEqual(['6-oro', '7-oro']);
  });

  it('names the single card when no suit repeats', () => {
    const result = envidoBreakdown([c(7, 'oro'), c(5, 'basto'), c(3, 'copa')]);
    expect(result.cards.map(cardId)).toEqual(['7-oro']);
  });

  it('drops the third card of the suit', () => {
    const result = envidoBreakdown([c(5, 'espada'), c(2, 'espada'), c(1, 'espada')]);
    expect(result.points).toBe(27);
    expect(result.cards.map(cardId).sort()).toEqual(['2-espada', '5-espada']);
  });

  it('returns nothing for an empty hand', () => {
    expect(envidoBreakdown([])).toEqual({ points: 0, cards: [] });
  });
});

describe('flor', () => {
  it('detects three of the same suit', () => {
    expect(hasFlor([c(5, 'oro'), c(2, 'oro'), c(11, 'oro')])).toBe(true);
    expect(florSuit([c(5, 'oro'), c(2, 'oro'), c(11, 'oro')])).toBe('oro');
  });

  it('two of a suit is not a flor', () => {
    expect(hasFlor([c(5, 'oro'), c(2, 'oro'), c(11, 'copa')])).toBe(false);
    expect(florSuit([c(5, 'oro'), c(2, 'oro'), c(11, 'copa')])).toBeNull();
    expect(florPoints([c(5, 'oro'), c(2, 'oro'), c(11, 'copa')])).toBe(0);
  });

  it('needs three cards', () => {
    expect(hasFlor([c(5, 'oro'), c(2, 'oro')])).toBe(false);
  });

  it('counts 20 plus all three cards', () => {
    expect(florPoints([c(7, 'oro'), c(6, 'oro'), c(5, 'oro')])).toBe(38);
    expect(florPoints([c(10, 'copa'), c(11, 'copa'), c(12, 'copa')])).toBe(20);
  });
});

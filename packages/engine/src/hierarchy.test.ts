import { describe, expect, it } from 'vitest';
import { DECK_SIZE, SUITS, cardId, cardLabel, type Card } from '@truco/shared';
import {
  MAX_STRENGTH,
  allCardsRanked,
  beats,
  byStrengthDesc,
  handStrength,
  hierarchyTiers,
  strengthOf,
  ties,
} from './hierarchy.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('truco hierarchy', () => {
  it('covers all 40 cards exactly once', () => {
    const ids = hierarchyTiers().flatMap((tier) => tier.map(cardId));
    expect(ids).toHaveLength(DECK_SIZE);
    expect(new Set(ids).size).toBe(DECK_SIZE);
  });

  it('has 14 tiers', () => {
    expect(MAX_STRENGTH).toBe(14);
    expect(hierarchyTiers()).toHaveLength(14);
  });

  // The canonical ordering, strongest to weakest, as a chain of strict inequalities.
  const chain: Card[] = [
    c(1, 'espada'),
    c(1, 'basto'),
    c(7, 'espada'),
    c(7, 'oro'),
    c(3, 'copa'),
    c(2, 'oro'),
    c(1, 'copa'),
    c(12, 'basto'),
    c(11, 'espada'),
    c(10, 'oro'),
    c(7, 'copa'),
    c(6, 'basto'),
    c(5, 'espada'),
    c(4, 'oro'),
  ];

  it.each(chain.slice(0, -1).map((card, i) => [card, chain[i + 1]!] as const))(
    '%o beats %o',
    (higher, lower) => {
      expect(beats(higher, lower)).toBe(true);
      expect(beats(lower, higher)).toBe(false);
      expect(ties(higher, lower)).toBe(false);
    },
  );

  it('is a total order across every pair in the chain', () => {
    for (let i = 0; i < chain.length; i++) {
      for (let j = i + 1; j < chain.length; j++) {
        expect(beats(chain[i]!, chain[j]!)).toBe(true);
      }
    }
  });

  describe('ties within a tier', () => {
    it.each([3, 2, 12, 11, 10, 6, 5, 4] as const)('all %ss tie with each other', (rank) => {
      for (const a of SUITS) {
        for (const b of SUITS) {
          expect(ties(c(rank, a), c(rank, b))).toBe(true);
        }
      }
    });

    it('the two false anchos tie', () => {
      expect(ties(c(1, 'copa'), c(1, 'oro'))).toBe(true);
    });

    it('the two weak sevens tie', () => {
      expect(ties(c(7, 'copa'), c(7, 'basto'))).toBe(true);
    });

    it('but the strong sevens do not tie with anything', () => {
      expect(beats(c(7, 'espada'), c(7, 'oro'))).toBe(true);
      expect(beats(c(7, 'oro'), c(7, 'copa'))).toBe(true);
      expect(beats(c(7, 'oro'), c(7, 'basto'))).toBe(true);
    });

    it('and the real anchos do not tie with the false ones', () => {
      expect(beats(c(1, 'espada'), c(1, 'oro'))).toBe(true);
      expect(beats(c(1, 'basto'), c(1, 'copa'))).toBe(true);
    });
  });

  it('ranks every card in the deck without gaps', () => {
    const ranked = allCardsRanked();
    expect(ranked).toHaveLength(DECK_SIZE);
    expect(cardLabel(ranked[0]!)).toBe('1 de espada');
    expect(strengthOf(ranked[0]!)).toBe(MAX_STRENGTH);
    expect(strengthOf(ranked[DECK_SIZE - 1]!)).toBe(1);
  });

  it('rejects cards outside the deck', () => {
    expect(() => strengthOf({ rank: 8 as Card['rank'], suit: 'oro' })).toThrow(/outside the deck/);
  });

  it('sorts strongest first', () => {
    const sorted = byStrengthDesc([c(4, 'oro'), c(1, 'espada'), c(3, 'copa')]);
    expect(sorted.map(cardId)).toEqual(['1-espada', '3-copa', '4-oro']);
  });
});

describe('handStrength', () => {
  it('is near 1 for the three strongest cards and near 0 for the weakest', () => {
    expect(handStrength([c(1, 'espada'), c(1, 'basto'), c(7, 'espada')])).toBeGreaterThan(0.94);
    expect(handStrength([c(4, 'oro'), c(4, 'copa'), c(4, 'basto')])).toBeLessThan(0.1);
  });

  it('weights the top card most', () => {
    // Same three strengths, redistributed: the hand led by the ancho reads stronger.
    const topHeavy = handStrength([c(1, 'espada'), c(4, 'oro'), c(4, 'copa')]);
    const spread = handStrength([c(6, 'espada'), c(6, 'oro'), c(5, 'copa')]);
    expect(topHeavy).toBeGreaterThan(spread);
    expect(handStrength([c(1, 'espada'), c(1, 'basto'), c(4, 'oro')])).toBeGreaterThan(topHeavy);
  });

  it('is 0 for an empty hand', () => {
    expect(handStrength([])).toBe(0);
  });
});

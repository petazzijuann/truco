import { describe, expect, it } from 'vitest';
import type { Card, PlayerId, TrickOutcome } from '@truco/shared';
import { nextLeader, resolveHandWinner, trickOutcome, type Play } from './tricks.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const play = (player: PlayerId, card: Card): Play => ({ player, card });

describe('trickOutcome', () => {
  it('awards the trick to the stronger card', () => {
    expect(trickOutcome([play('human', c(1, 'espada')), play('ai', c(1, 'basto'))])).toBe('human');
    expect(trickOutcome([play('human', c(4, 'oro')), play('ai', c(3, 'copa'))])).toBe('ai');
  });

  it('is a parda when the cards tie', () => {
    expect(trickOutcome([play('human', c(3, 'oro')), play('ai', c(3, 'copa'))])).toBe('parda');
  });

  it('does not care who led', () => {
    expect(trickOutcome([play('ai', c(1, 'basto')), play('human', c(1, 'espada'))])).toBe('human');
  });

  it('rejects an incomplete trick', () => {
    expect(() => trickOutcome([play('human', c(3, 'oro'))])).toThrow(/needs two plays/);
    expect(() => trickOutcome([])).toThrow(/needs two plays/);
  });
});

describe('resolveHandWinner', () => {
  const H: PlayerId = 'human';
  const A: PlayerId = 'ai';
  const P: TrickOutcome = 'parda';

  it('is undecided before any trick', () => {
    expect(resolveHandWinner([], H)).toBeNull();
    expect(resolveHandWinner([], A)).toBeNull();
  });

  it('is undecided after one decided trick', () => {
    expect(resolveHandWinner([H], H)).toBeNull();
  });

  it('two tricks for the same player wins the hand', () => {
    expect(resolveHandWinner([H, H], A)).toBe(H);
    expect(resolveHandWinner([A, A], H)).toBe(A);
  });

  describe('parda in the first trick', () => {
    it('is undecided until the second resolves', () => {
      expect(resolveHandWinner([P], H)).toBeNull();
    });

    it('whoever wins the second wins the hand', () => {
      expect(resolveHandWinner([P, H], A)).toBe(H);
      expect(resolveHandWinner([P, A], H)).toBe(A);
    });

    it('parda in the second too: the third decides', () => {
      expect(resolveHandWinner([P, P], H)).toBeNull();
      expect(resolveHandWinner([P, P, A], H)).toBe(A);
      expect(resolveHandWinner([P, P, H], A)).toBe(H);
    });

    it('all three parda: the mano wins', () => {
      expect(resolveHandWinner([P, P, P], H)).toBe(H);
      expect(resolveHandWinner([P, P, P], A)).toBe(A);
    });
  });

  describe('parda in the second trick', () => {
    it('the first-trick winner takes the hand', () => {
      expect(resolveHandWinner([H, P], A)).toBe(H);
      expect(resolveHandWinner([A, P], H)).toBe(A);
    });
  });

  describe('one trick each', () => {
    it('is undecided until the third', () => {
      expect(resolveHandWinner([H, A], H)).toBeNull();
    });

    it('whoever wins the third wins the hand', () => {
      expect(resolveHandWinner([H, A, A], H)).toBe(A);
      expect(resolveHandWinner([A, H, H], A)).toBe(H);
    });

    it('parda in the third: the first-trick winner takes the hand', () => {
      expect(resolveHandWinner([H, A, P], A)).toBe(H);
      expect(resolveHandWinner([A, H, P], H)).toBe(A);
    });
  });
});

describe('nextLeader', () => {
  it('is the trick winner', () => {
    expect(nextLeader('human', 'ai')).toBe('human');
  });

  it('is the mano after a parda', () => {
    expect(nextLeader('parda', 'ai')).toBe('ai');
    expect(nextLeader('parda', 'human')).toBe('human');
  });
});

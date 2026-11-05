import { describe, expect, it } from 'vitest';
import { checkInvariants } from './invariants.js';
import { buildState, type ScenarioOptions } from './scenario.js';
import { c, playOf, run } from './helpers.test-utils.js';
import type { GameState } from './state.js';

const HIGH = [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')];
const LOW = [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')];
const fresh = (over: Partial<ScenarioOptions> = {}) =>
  buildState({ human: HIGH, ai: LOW, mano: 'human', ...over });

/**
 * An invariant checker that cannot fail proves nothing, so each case here corrupts a
 * state on purpose and asserts the corruption is caught.
 */
const corrupt = (mutate: (state: GameState) => void): string[] => {
  const state = fresh();
  mutate(state);
  return checkInvariants(state);
};

describe('checkInvariants', () => {
  it('passes on a clean state', () => {
    expect(checkInvariants(fresh())).toEqual([]);
  });

  it('passes mid-hand', () => {
    const state = run(fresh(), [
      ['human', playOf(c(7, 'oro'))],
      ['ai', playOf(c(5, 'espada'))],
    ]);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('catches a missing card', () => {
    expect(corrupt((state) => state.undealt.pop())).toContain(
      '39 cards accounted for, expected 40',
    );
  });

  it('catches a duplicated card', () => {
    const problems = corrupt((state) => {
      state.undealt[0] = { ...state.dealt.human[0]! };
    });
    expect(problems).toContain('a card appears twice in the deck');
  });

  it('catches a hand that was not dealt three cards', () => {
    const problems = corrupt((state) => {
      state.dealt.human = state.dealt.human.slice(0, 2);
    });
    expect(problems).toContain('human was dealt 2 cards');
  });

  it('catches a seat holding a card it was never dealt', () => {
    const problems = corrupt((state) => {
      state.hands.ai = [...state.dealt.human];
    });
    expect(problems).toContain('ai holds a card it was not dealt');
  });

  it('catches a negative score', () => {
    expect(corrupt((state) => (state.scores.ai = -1))).toContain('ai has a negative score');
  });

  it('catches a seat playing the other seat card', () => {
    const problems = corrupt((state) => {
      state.tricks[0]!.plays.push({ player: 'ai', card: c(7, 'oro') });
      state.hands.ai = state.hands.ai.slice(1);
    });
    expect(problems).toContain('ai played 7-oro, which was never theirs');
  });

  it('catches a played card that never left the hand', () => {
    const problems = corrupt((state) => {
      state.tricks[0]!.plays.push({ player: 'human', card: c(7, 'oro') });
    });
    expect(problems).toContain('human holds 3 cards, expected 2');
  });

  it('catches a fourth trick', () => {
    const problems = corrupt((state) => {
      state.tricks = [0, 1, 2, 3].map(() => ({ plays: [], outcome: null }));
    });
    expect(problems).toContain('4 tricks in one hand');
  });

  it('catches a winner declared below the target', () => {
    const problems = corrupt((state) => {
      state.winner = 'human';
    });
    expect(problems).toContain('declared a winner below the target score');
  });

  it('catches game over with nobody winning', () => {
    const problems = corrupt((state) => {
      state.phase = 'gameOver';
    });
    expect(problems).toContain('game over with no winner');
  });

  it('catches two calls pending at once', () => {
    const problems = corrupt((state) => {
      state.truco.pending = { by: 'human', call: 'truco' };
      state.envido.pending = { by: 'ai', call: 'envido' };
    });
    expect(problems).toContain('two calls pending at once');
  });
});

describe('buildState', () => {
  it('rejects a hand that is not three cards', () => {
    expect(() => buildState({ human: HIGH.slice(0, 2), ai: LOW })).toThrow(/human needs 3 cards/);
    expect(() => buildState({ human: HIGH, ai: LOW.slice(0, 1) })).toThrow(/ai needs 3 cards/);
  });

  it('rejects the same card in both hands', () => {
    expect(() => buildState({ human: HIGH, ai: [...LOW.slice(0, 2), c(7, 'oro')] })).toThrow(
      /duplicate card/,
    );
  });

  it('leaves 34 cards undealt', () => {
    expect(fresh().undealt).toHaveLength(34);
    expect(checkInvariants(fresh())).toEqual([]);
  });
});

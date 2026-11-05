import { describe, expect, it } from 'vitest';
import { defaultConfig, seededRng } from '@truco/shared';
import { applyAction } from './apply.js';
import { getLegalActions } from './legal.js';
import { createGame } from './state.js';
import { IllegalActionError } from './errors.js';
import { buildState } from './scenario.js';
import { c, canDo, legalTypes, playOf, run, testRng } from './helpers.test-utils.js';

const HIGH = [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')];
const LOW = [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')];
const fresh = () => buildState({ human: HIGH, ai: LOW, mano: 'human' });

describe('irse al mazo', () => {
  it('concedes the current truco value plus the first-trick penalty', () => {
    const state = run(fresh(), [['human', { type: 'irseAlMazo' }]]);
    // Nothing called (worth 1) + 1 for leaving in the first trick with no envido played.
    expect(state.lastHandResult).toEqual({ winner: 'ai', points: 2, reason: 'mazo' });
    expect(state.scores.ai).toBe(2);
  });

  it('drops the penalty once the envido has been settled', () => {
    const state = run(fresh(), [
      ['human', { type: 'envido' }],
      ['ai', { type: 'noQuiero' }],
      ['human', { type: 'irseAlMazo' }],
    ]);
    expect(state.lastHandResult).toEqual({ winner: 'ai', points: 1, reason: 'mazo' });
    // The human still banked the refused envido.
    expect(state.scores.human).toBe(1);
    expect(state.scores.ai).toBe(1);
  });

  it('drops the penalty after the first trick', () => {
    const state = run(fresh(), [
      ['human', playOf(c(7, 'oro'))],
      ['ai', playOf(c(5, 'espada'))],
      ['human', { type: 'irseAlMazo' }],
    ]);
    expect(state.lastHandResult).toEqual({ winner: 'ai', points: 1, reason: 'mazo' });
  });

  it('concedes the accepted truco value', () => {
    const state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'quiero' }],
      ['human', { type: 'irseAlMazo' }],
    ]);
    // Truco accepted (2) + first-trick penalty (1).
    expect(state.lastHandResult).toEqual({ winner: 'ai', points: 3, reason: 'mazo' });
  });

  it('can be configured off', () => {
    const state = run(
      buildState({ human: HIGH, ai: LOW, mano: 'human', config: { mazoPrimeraPenalty: false } }),
      [['human', { type: 'irseAlMazo' }]],
    );
    expect(state.lastHandResult?.points).toBe(1);
  });

  it('is not available while a call awaits an answer', () => {
    const state = run(fresh(), [['human', { type: 'truco' }]]);
    expect(canDo(state, 'ai', 'irseAlMazo')).toBe(false);
    expect(() => applyAction(state, 'ai', { type: 'irseAlMazo' }, testRng())).toThrow(
      IllegalActionError,
    );
  });

  it('is available in the second and third tricks', () => {
    let state = run(fresh(), [
      ['human', playOf(c(7, 'oro'))],
      ['ai', playOf(c(5, 'espada'))],
    ]);
    expect(canDo(state, 'human', 'irseAlMazo')).toBe(true);
    state = run(state, [
      ['human', playOf(c(6, 'oro'))],
      ['ai', playOf(c(2, 'espada'))],
    ]);
    expect(canDo(state, 'ai', 'irseAlMazo')).toBe(true);
    expect(state.tricks).toHaveLength(3);
  });
});

describe('hand and game flow', () => {
  it('goes to a third trick when the first two are split', () => {
    const state = run(fresh(), [
      ['human', playOf(c(7, 'oro'))],
      ['ai', playOf(c(5, 'espada'))],
      ['human', playOf(c(4, 'copa'))],
      ['ai', playOf(c(12, 'basto'))],
      ['ai', playOf(c(2, 'espada'))],
      ['human', playOf(c(6, 'oro'))],
    ]);
    expect(state.tricks).toHaveLength(3);
    expect(state.phase).toBe('handOver');
    expect(state.lastHandResult).toEqual({ winner: 'ai', points: 1, reason: 'tricks' });
  });

  it('stops at two tricks when one seat takes both', () => {
    const state = run(
      buildState({
        human: [c(1, 'espada'), c(1, 'basto'), c(4, 'copa')],
        ai: [c(4, 'oro'), c(5, 'oro'), c(12, 'basto')],
        mano: 'human',
      }),
      [
        ['human', playOf(c(1, 'espada'))],
        ['ai', playOf(c(4, 'oro'))],
        ['human', playOf(c(1, 'basto'))],
        ['ai', playOf(c(5, 'oro'))],
      ],
    );
    expect(state.tricks).toHaveLength(2);
    expect(state.lastHandResult).toEqual({ winner: 'human', points: 1, reason: 'tricks' });
    // Each seat still holds its untouched third card.
    expect(state.hands.human).toHaveLength(1);
  });

  it('alternates the mano on every deal', () => {
    let state = run(fresh(), [['human', { type: 'irseAlMazo' }]]);
    expect(state.phase).toBe('handOver');
    expect(legalTypes(state, 'human')).toEqual(['nextHand']);
    expect(legalTypes(state, 'ai')).toEqual(['nextHand']);

    state = run(state, [['human', { type: 'nextHand' }]]);
    expect(state.mano).toBe('ai');
    expect(state.handNumber).toBe(2);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('ai');
    // Fresh per-hand state.
    expect(state.truco.level).toBe(0);
    expect(state.envido.resolved).toBeNull();
    expect(state.revealed.ai).toEqual([]);
    expect(state.hands.human).toHaveLength(3);
    expect(state.log.map((event) => event.type)).toEqual(['handDealt']);
  });

  it('refuses everything once the game is over', () => {
    const state = run(buildState({ human: HIGH, ai: LOW, mano: 'human', scores: { ai: 29 } }), [
      ['human', { type: 'irseAlMazo' }],
    ]);
    expect(state.winner).toBe('ai');
    expect(state.phase).toBe('gameOver');
    expect(legalTypes(state, 'human')).toEqual([]);
    expect(() => applyAction(state, 'human', { type: 'nextHand' }, testRng())).toThrow(
      IllegalActionError,
    );
  });

  it('plays a full game to the target from a random deal', () => {
    const rng = seededRng(2024);
    let state = createGame(defaultConfig(), rng);
    let guard = 0;
    while (state.winner === null) {
      if (guard++ > 5_000) throw new Error('game did not terminate');
      const player = state.phase === 'handOver' ? state.mano : state.turn;
      const [action] = getLegalActions(state, player);
      if (action === undefined) throw new Error(`no legal action for ${player}`);
      state = applyAction(state, player, action, rng);
    }
    expect(state.scores[state.winner]).toBeGreaterThanOrEqual(30);
    expect(state.phase).toBe('gameOver');
  });
});

describe('immutability', () => {
  it('never mutates the state it was given', () => {
    const before = fresh();
    const snapshot = JSON.stringify(before);
    applyAction(before, 'human', { type: 'truco' }, testRng());
    applyAction(before, 'human', playOf(c(7, 'oro')), testRng());
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('reports only the events produced by the latest action', () => {
    const state = run(fresh(), [['human', { type: 'truco' }]]);
    expect(state.emitted.map((event) => event.type)).toEqual(['called']);
    const next = run(state, [['ai', { type: 'quiero' }]]);
    expect(next.emitted.map((event) => event.type)).toEqual(['responded']);
    // The hand log keeps both.
    expect(next.log.map((event) => event.type)).toEqual(['called', 'responded']);
    expect(next.log.map((event) => event.seq)).toEqual([1, 2]);
  });
});

describe('createGame', () => {
  it('draws the first mano and deals three cards each', () => {
    const state = createGame(defaultConfig(), seededRng(5));
    expect(state.hands.human).toHaveLength(3);
    expect(state.hands.ai).toHaveLength(3);
    expect(state.undealt).toHaveLength(34);
    expect(state.turn).toBe(state.mano);
    expect(state.handNumber).toBe(1);
  });

  it('does not always hand the deal to the same seat', () => {
    const manos = new Set(
      Array.from({ length: 20 }, (_, seed) => createGame(defaultConfig(), seededRng(seed)).mano),
    );
    expect(manos.size).toBe(2);
  });
});

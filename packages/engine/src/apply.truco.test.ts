import { describe, expect, it } from 'vitest';
import { IllegalActionError } from './errors.js';
import { applyAction } from './apply.js';
import { buildState } from './scenario.js';
import { c, canDo, legalTypes, playOf, run, testRng } from './helpers.test-utils.js';

const hands = {
  human: [c(1, 'espada'), c(5, 'oro'), c(4, 'copa')],
  ai: [c(1, 'basto'), c(6, 'oro'), c(4, 'basto')],
} as const;

const fresh = () => buildState({ ...hands, mano: 'human' });

describe('truco ladder', () => {
  it('a hand with no call is worth 1', () => {
    const state = fresh();
    expect(state.truco.level).toBe(0);
    const played = run(state, [
      ['human', playOf(c(1, 'espada'))],
      ['ai', playOf(c(1, 'basto'))],
      ['human', playOf(c(5, 'oro'))],
      ['ai', playOf(c(6, 'oro'))],
      ['ai', playOf(c(4, 'basto'))],
      ['human', playOf(c(4, 'copa'))],
    ]);
    // Human took the first, ai the second, the third was a parda: the first wins it.
    expect(played.lastHandResult).toEqual({ winner: 'human', points: 1, reason: 'tricks' });
    expect(played.scores.human).toBe(1);
  });

  it('escalates 2 -> 3 -> 4, and only on the raiser own turn', () => {
    // Truco accepted: the hand is worth 2 and the ai holds la palabra.
    let state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'quiero' }],
    ]);
    expect(state.truco.level).toBe(1);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('human');
    expect(state.truco.wordHolder).toBe('ai');

    // The ai must wait for its own turn before raising.
    state = run(state, [['human', playOf(c(1, 'espada'))]]);
    state = run(state, [
      ['ai', { type: 'retruco' }],
      ['human', { type: 'quiero' }],
    ]);
    expect(state.truco.level).toBe(2);
    expect(state.truco.wordHolder).toBe('human');
    expect(state.turn).toBe('ai');

    // Ai finishes the trick, the human (trick winner) leads and calls vale cuatro.
    state = run(state, [['ai', playOf(c(1, 'basto'))]]);
    expect(state.turn).toBe('human');
    state = run(state, [
      ['human', { type: 'valeCuatro' }],
      ['ai', { type: 'quiero' }],
    ]);
    expect(state.truco.level).toBe(3);
    expect(state.truco.wordHolder).toBe('ai');
    // The ladder is exhausted.
    expect(canDo(state, 'ai', 'truco')).toBe(false);
  });

  it('truco refused pays the caller 1', () => {
    const state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'noQuiero' }],
    ]);
    expect(state.lastHandResult).toEqual({ winner: 'human', points: 1, reason: 'trucoRejected' });
    expect(state.scores.human).toBe(1);
    expect(state.phase).toBe('handOver');
  });

  it('retruco refused pays the caller 2', () => {
    const state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'quiero' }],
      ['human', playOf(c(1, 'espada'))],
      ['ai', { type: 'retruco' }],
      ['human', { type: 'noQuiero' }],
    ]);
    expect(state.lastHandResult).toEqual({ winner: 'ai', points: 2, reason: 'trucoRejected' });
    expect(state.scores.ai).toBe(2);
  });

  it('vale cuatro refused pays the caller 3', () => {
    const state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'quiero' }],
      ['human', playOf(c(1, 'espada'))],
      ['ai', { type: 'retruco' }],
      ['human', { type: 'quiero' }],
      ['ai', playOf(c(1, 'basto'))],
      ['human', { type: 'valeCuatro' }],
      ['ai', { type: 'noQuiero' }],
    ]);
    expect(state.lastHandResult).toEqual({ winner: 'human', points: 3, reason: 'trucoRejected' });
    expect(state.scores.human).toBe(3);
  });

  it('"quiero retruco" accepts and raises in one move', () => {
    let state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'retruco' }],
    ]);
    // The truco is now accepted (level 1) with a retruco awaiting an answer.
    expect(state.truco.level).toBe(1);
    expect(state.truco.pending).toEqual({ by: 'ai', call: 'retruco' });
    expect(state.truco.wordHolder).toBe('ai');
    expect(state.turn).toBe('human');

    // Refusing the retruco pays 2, not 1.
    state = run(state, [['human', { type: 'noQuiero' }]]);
    expect(state.lastHandResult?.points).toBe(2);
  });

  it('only the seat holding la palabra may raise', () => {
    const state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'quiero' }],
    ]);
    expect(state.truco.wordHolder).toBe('ai');
    // It is the human's turn to play, but the human does not hold the word.
    expect(state.turn).toBe('human');
    expect(canDo(state, 'human', 'retruco')).toBe(false);
    expect(() => applyAction(state, 'human', { type: 'retruco' }, testRng())).toThrow(
      IllegalActionError,
    );

    // Once the human plays, the ai may raise on its turn.
    const next = run(state, [['human', playOf(c(1, 'espada'))]]);
    expect(canDo(next, 'ai', 'retruco')).toBe(true);
  });

  it('nobody can call twice in a row', () => {
    const state = run(fresh(), [['human', { type: 'truco' }]]);
    // The call is pending: the human cannot stack another on top of it.
    expect(canDo(state, 'human', 'retruco')).toBe(false);
    expect(legalTypes(state, 'human')).toEqual([]);
    expect(legalTypes(state, 'ai').sort()).toEqual(
      ['envido', 'faltaEnvido', 'noQuiero', 'quiero', 'realEnvido', 'retruco'].sort(),
    );
  });

  it('can be called in any trick, before playing the card', () => {
    let state = run(fresh(), [
      ['human', playOf(c(1, 'espada'))],
      ['ai', playOf(c(1, 'basto'))],
    ]);
    expect(state.turn).toBe('human');
    expect(canDo(state, 'human', 'truco')).toBe(true);
    state = run(state, [
      ['human', { type: 'truco' }],
      ['ai', { type: 'quiero' }],
      ['human', playOf(c(5, 'oro'))],
      ['ai', playOf(c(6, 'oro'))],
      ['ai', playOf(c(4, 'basto'))],
      ['human', playOf(c(4, 'copa'))],
    ]);
    // 1-espada > 1-basto, 6-oro > 5-oro, 4s tie -> first-trick winner takes it.
    expect(state.lastHandResult).toEqual({ winner: 'human', points: 2, reason: 'tricks' });
  });

  it('refuses an action from the seat that is not on turn', () => {
    const state = fresh();
    expect(legalTypes(state, 'ai')).toEqual([]);
    expect(() => applyAction(state, 'ai', { type: 'truco' }, testRng())).toThrow(
      IllegalActionError,
    );
  });

  it('refuses a card the player does not hold', () => {
    const state = fresh();
    expect(() => applyAction(state, 'human', playOf(c(1, 'basto')), testRng())).toThrow(
      IllegalActionError,
    );
  });
});

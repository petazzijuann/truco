import { describe, expect, it } from 'vitest';
import type { EnvidoCall, GameConfig, PlayerId } from '@truco/shared';
import { applyAction } from './apply.js';
import { IllegalActionError } from './errors.js';
import { buildState, type ScenarioOptions } from './scenario.js';
import { c, canDo, legalTypes, playOf, run, testRng } from './helpers.test-utils.js';

// human counts 33 (7 + 6 of oro); ai counts 27 (5 + 2 of espada).
const HIGH = [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')];
const LOW = [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')];

const fresh = (over: Partial<ScenarioOptions> = {}) =>
  buildState({ human: HIGH, ai: LOW, mano: 'human', ...over });

type EnvidoSetup = {
  mano?: PlayerId;
  scores?: Partial<Record<PlayerId, number>>;
  config?: Partial<GameConfig>;
};

/** Stack a chain of envido calls, alternating seats, starting from the mano. */
function playEnvido(chain: readonly EnvidoCall[], setup: EnvidoSetup = {}) {
  let state = fresh(setup);
  let caller: PlayerId = state.mano;
  for (const call of chain) {
    state = run(state, [[caller, { type: call }]]);
    caller = caller === 'human' ? 'ai' : 'human';
  }
  // `caller` now points at the seat that owes an answer.
  return { state, nextToAnswer: caller };
}

/** Stack a chain, accept it, and have both seats state their counts. */
function acceptAndDeclare(chain: readonly EnvidoCall[], setup: EnvidoSetup = {}) {
  const { state, nextToAnswer } = playEnvido(chain, setup);
  const next = run(state, [[nextToAnswer, { type: 'quiero' }]]);
  const mano = next.mano;
  const other: PlayerId = mano === 'human' ? 'ai' : 'human';
  return run(next, [
    [mano, { type: 'declarePoints' }],
    [other, { type: 'declarePoints' }],
  ]);
}

describe('envido values, accepted', () => {
  it.each([
    [['envido'], 2],
    [['envido', 'envido'], 4],
    [['realEnvido'], 3],
    [['envido', 'realEnvido'], 5],
    [['envido', 'envido', 'realEnvido'], 7],
  ] as const)('%j accepted is worth %i', (chain, points) => {
    const state = acceptAndDeclare(chain);
    expect(state.envido.resolved).toEqual({ winner: 'human', points, wanted: true });
    expect(state.scores.human).toBe(points);
    expect(state.scores.ai).toBe(0);
  });
});

describe('envido values, refused', () => {
  it.each([
    [['envido'], 1],
    [['envido', 'envido'], 2],
    [['realEnvido'], 1],
    [['envido', 'realEnvido'], 2],
    [['envido', 'envido', 'realEnvido'], 4],
    [['faltaEnvido'], 1],
    [['envido', 'faltaEnvido'], 2],
    [['envido', 'envido', 'realEnvido', 'faltaEnvido'], 7],
  ] as const)('%j refused pays the last caller %i', (chain, points) => {
    const { state, nextToAnswer } = playEnvido(chain);
    const caller: PlayerId = nextToAnswer === 'human' ? 'ai' : 'human';
    const next = run(state, [[nextToAnswer, { type: 'noQuiero' }]]);
    expect(next.envido.resolved).toEqual({ winner: caller, points, wanted: false });
    expect(next.scores[caller]).toBe(points);
    // Refusing the envido does not end the hand -- play resumes.
    expect(next.phase).toBe('playing');
  });
});

describe('falta envido', () => {
  it('in las malas it wins the whole game', () => {
    const state = acceptAndDeclare(['faltaEnvido'], { scores: { human: 4, ai: 7 } });
    // The leader (ai, 7) is below 15, so the winner jumps straight to the target.
    expect(state.envido.resolved?.points).toBe(30 - 4);
    expect(state.scores.human).toBe(30);
    expect(state.winner).toBe('human');
    expect(state.phase).toBe('gameOver');
  });

  it('in las buenas it is worth what the leader still needs', () => {
    const state = acceptAndDeclare(['faltaEnvido'], { scores: { human: 12, ai: 22 } });
    expect(state.envido.resolved?.points).toBe(30 - 22);
    expect(state.scores.human).toBe(20);
    expect(state.winner).toBeNull();
  });

  it('won by the leader in las buenas it closes the game', () => {
    const state = acceptAndDeclare(['faltaEnvido'], { scores: { human: 24, ai: 16 } });
    expect(state.envido.resolved?.points).toBe(6);
    expect(state.scores.human).toBe(30);
    expect(state.winner).toBe('human');
  });

  it('stacked on a chain it is still worth the falta', () => {
    const state = acceptAndDeclare(['envido', 'faltaEnvido'], { scores: { human: 10, ai: 20 } });
    expect(state.envido.resolved?.points).toBe(10);
  });

  it('closes the chain: nothing may be stacked on top', () => {
    const { state } = playEnvido(['faltaEnvido']);
    expect(legalTypes(state, 'ai').sort()).toEqual(['noQuiero', 'quiero']);
  });

  it('simple mode ignores the malas rule', () => {
    const state = acceptAndDeclare(['faltaEnvido'], {
      scores: { human: 4, ai: 7 },
      config: { faltaEnvidoMode: 'simple' },
    });
    expect(state.envido.resolved?.points).toBe(30 - 7);
    expect(state.winner).toBeNull();
  });

  it('respects a 15-point target', () => {
    const state = acceptAndDeclare(['faltaEnvido'], {
      scores: { human: 2, ai: 5 },
      config: { target: 15 },
    });
    // The leader (5) is below 7.5, so it is the whole game.
    expect(state.scores.human).toBe(15);
    expect(state.winner).toBe('human');
  });
});

describe('envido chain legality', () => {
  it('offers the three opening calls', () => {
    const types = legalTypes(fresh(), 'human');
    expect(types).toContain('envido');
    expect(types).toContain('realEnvido');
    expect(types).toContain('faltaEnvido');
  });

  it('allows at most two plain envidos', () => {
    const { state } = playEnvido(['envido', 'envido']);
    expect(legalTypes(state, 'human')).not.toContain('envido');
    expect(legalTypes(state, 'human')).toContain('realEnvido');
  });

  it('cannot go back to a plain envido after a real envido', () => {
    const { state } = playEnvido(['realEnvido']);
    expect(legalTypes(state, 'ai')).not.toContain('envido');
    expect(legalTypes(state, 'ai')).not.toContain('realEnvido');
    expect(legalTypes(state, 'ai')).toContain('faltaEnvido');
  });

  it('cannot be called again once settled', () => {
    const state = acceptAndDeclare(['envido']);
    expect(canDo(state, 'human', 'envido')).toBe(false);
    expect(state.envido.resolved).not.toBeNull();
  });

  it('cannot be called after the first trick', () => {
    const state = run(fresh(), [
      ['human', playOf(c(4, 'copa'))],
      ['ai', playOf(c(12, 'basto'))],
    ]);
    expect(state.tricks).toHaveLength(2);
    expect(canDo(state, 'human', 'envido')).toBe(false);
    expect(() => applyAction(state, 'human', { type: 'envido' }, testRng())).toThrow(
      IllegalActionError,
    );
  });

  it('cannot be called once you have played your card', () => {
    const state = run(fresh(), [['human', playOf(c(4, 'copa'))]]);
    // The mano already played, so only the other seat may still open the envido.
    expect(canDo(state, 'human', 'envido')).toBe(false);
    expect(canDo(state, 'ai', 'envido')).toBe(true);

    const afterAi = run(state, [['ai', { type: 'envido' }]]);
    // The human may answer or raise the envido, but could not have opened it.
    expect(legalTypes(afterAi, 'human').sort()).toEqual(
      ['envido', 'faltaEnvido', 'noQuiero', 'quiero', 'realEnvido'].sort(),
    );
  });
});

describe('declaring the points', () => {
  it('the mano speaks first and must state a number', () => {
    const { state, nextToAnswer } = playEnvido(['envido']);
    const accepted = run(state, [[nextToAnswer, { type: 'quiero' }]]);
    expect(accepted.phase).toBe('envidoDeclaring');
    expect(accepted.turn).toBe('human');
    expect(legalTypes(accepted, 'human')).toEqual(['declarePoints']);
  });

  it('the second seat may concede with "son buenas"', () => {
    const { state, nextToAnswer } = playEnvido(['envido']);
    let next = run(state, [
      [nextToAnswer, { type: 'quiero' }],
      ['human', { type: 'declarePoints' }],
    ]);
    expect(legalTypes(next, 'ai').sort()).toEqual(['declarePoints', 'sonBuenas']);
    next = run(next, [['ai', { type: 'sonBuenas' }]]);
    expect(next.envido.resolved).toEqual({ winner: 'human', points: 2, wanted: true });
    expect(next.envido.declarations).toEqual([
      { player: 'human', points: 33 },
      { player: 'ai', points: 'buenas' },
    ]);
  });

  it('reads the real count off the hand, so a client cannot lie', () => {
    const state = acceptAndDeclare(['envido']);
    expect(state.envido.declarations).toEqual([
      { player: 'human', points: 33 },
      { player: 'ai', points: 27 },
    ]);
  });

  it('a tie goes to the mano', () => {
    // Both seats count 27.
    let state = buildState({
      human: [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')],
      ai: [c(5, 'oro'), c(2, 'oro'), c(12, 'copa')],
      mano: 'ai',
    });
    state = run(state, [
      ['ai', { type: 'envido' }],
      ['human', { type: 'quiero' }],
      ['ai', { type: 'declarePoints' }],
      ['human', { type: 'declarePoints' }],
    ]);
    expect(state.envido.declarations.map((entry) => entry.points)).toEqual([27, 27]);
    expect(state.envido.resolved?.winner).toBe('ai');
  });

  it('the higher count wins even when the mano spoke first', () => {
    let state = fresh({ mano: 'ai' });
    state = run(state, [
      ['ai', { type: 'envido' }],
      ['human', { type: 'quiero' }],
      ['ai', { type: 'declarePoints' }],
      ['human', { type: 'declarePoints' }],
    ]);
    expect(state.envido.resolved?.winner).toBe('human');
  });
});

describe('el envido está primero', () => {
  it('answers a truco with an envido, settles it, then returns to the truco', () => {
    // The human (mano) calls truco before playing; the ai answers with envido.
    let state = run(fresh(), [['human', { type: 'truco' }]]);
    expect(canDo(state, 'ai', 'envido')).toBe(true);

    state = run(state, [['ai', { type: 'envido' }]]);
    expect(state.phase).toBe('envidoResponse');
    expect(state.truco.pending).toBeNull();
    expect(state.trucoInterrupted).toEqual({ by: 'human', call: 'truco' });
    expect(state.turn).toBe('human');

    state = run(state, [
      ['human', { type: 'quiero' }],
      ['human', { type: 'declarePoints' }],
      ['ai', { type: 'declarePoints' }],
    ]);
    expect(state.envido.resolved).toEqual({ winner: 'human', points: 2, wanted: true });
    // The parked truco is back on the table, awaiting the ai's answer.
    expect(state.phase).toBe('trucoResponse');
    expect(state.truco.pending).toEqual({ by: 'human', call: 'truco' });
    expect(state.trucoInterrupted).toBeNull();
    expect(state.turn).toBe('ai');

    state = run(state, [['ai', { type: 'quiero' }]]);
    expect(state.truco.level).toBe(1);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('human');
  });

  it('works when the envido is refused too', () => {
    let state = run(fresh(), [
      ['human', { type: 'truco' }],
      ['ai', { type: 'realEnvido' }],
      ['human', { type: 'noQuiero' }],
    ]);
    expect(state.scores.ai).toBe(1);
    expect(state.phase).toBe('trucoResponse');
    expect(state.turn).toBe('ai');
    state = run(state, [['ai', { type: 'noQuiero' }]]);
    expect(state.lastHandResult).toEqual({ winner: 'human', points: 1, reason: 'trucoRejected' });
  });

  it('is not available to a seat that already played its card', () => {
    const state = run(fresh(), [
      ['human', playOf(c(4, 'copa'))],
      ['ai', { type: 'truco' }],
    ]);
    expect(legalTypes(state, 'human').sort()).toEqual(['noQuiero', 'quiero', 'retruco']);
  });

  it('ends the game mid-hand when the envido reaches the target', () => {
    const state = acceptAndDeclare(['realEnvido'], { scores: { human: 28, ai: 10 } });
    expect(state.scores.human).toBe(31);
    expect(state.winner).toBe('human');
    expect(state.phase).toBe('gameOver');
    expect(state.lastHandResult).toEqual({ winner: 'human', points: 3, reason: 'target' });
    expect(legalTypes(state, 'human')).toEqual([]);
    expect(legalTypes(state, 'ai')).toEqual([]);
  });
});

describe('end-of-hand reveal', () => {
  it('shows only the cards that justify the winning count', () => {
    let state = acceptAndDeclare(['envido']);
    state = run(state, [
      ['human', playOf(c(7, 'oro'))],
      ['ai', playOf(c(5, 'espada'))],
      ['human', playOf(c(6, 'oro'))],
      ['ai', playOf(c(12, 'basto'))],
      ['ai', playOf(c(2, 'espada'))],
      ['human', playOf(c(4, 'copa'))],
    ]);
    expect(state.phase).toBe('handOver');
    // The 7 and 6 of oro back the 33; the 4 of copa took no part and stays hidden.
    expect(state.revealed.human.map((card) => `${card.rank}-${card.suit}`).sort()).toEqual([
      '6-oro',
      '7-oro',
    ]);
    expect(state.revealed.ai).toEqual([]);
  });

  it('reveals nothing when the envido was refused', () => {
    let state = run(fresh(), [
      ['human', { type: 'envido' }],
      ['ai', { type: 'noQuiero' }],
    ]);
    state = run(state, [
      ['human', playOf(c(7, 'oro'))],
      ['ai', playOf(c(5, 'espada'))],
      ['human', playOf(c(6, 'oro'))],
      ['ai', playOf(c(12, 'basto'))],
      ['ai', playOf(c(2, 'espada'))],
      ['human', playOf(c(4, 'copa'))],
    ]);
    expect(state.revealed.human).toEqual([]);
  });
});

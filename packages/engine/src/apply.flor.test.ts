import { describe, expect, it } from 'vitest';
import { cardId } from '@truco/shared';
import { applyAction } from './apply.js';
import { IllegalActionError } from './errors.js';
import { getPlayerView } from './playerView.js';
import { buildState, type ScenarioOptions } from './scenario.js';
import { c, canDo, legalTypes, playOf, run, testRng } from './helpers.test-utils.js';

// Flor of oro, counting 20 + 7 + 6 + 5 = 38.
const FLOR_BIG = [c(7, 'oro'), c(6, 'oro'), c(5, 'oro')];
// Flor of copa, counting 20 + 4 + 3 + 2 = 29.
const FLOR_SMALL = [c(4, 'copa'), c(3, 'copa'), c(2, 'copa')];
// No flor; envido 27.
const NO_FLOR = [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')];

const withFlor = (over: Partial<ScenarioOptions> = {}) =>
  buildState({
    human: FLOR_BIG,
    ai: NO_FLOR,
    mano: 'human',
    ...over,
    config: { flor: true, ...over.config },
  });

describe('flor is off by default', () => {
  it('is not offered and is refused outright', () => {
    const state = buildState({ human: FLOR_BIG, ai: NO_FLOR, mano: 'human' });
    expect(state.config.flor).toBe(false);
    expect(canDo(state, 'human', 'flor')).toBe(false);
    expect(() => applyAction(state, 'human', { type: 'flor' }, testRng())).toThrow(
      IllegalActionError,
    );
    // Without flor enabled, a seat holding three of a suit counts a normal envido.
    expect(getPlayerView(state, 'human').iHaveFlor).toBe(false);
    expect(canDo(state, 'human', 'envido')).toBe(true);
  });
});

describe('announcing a flor', () => {
  it('is offered only to a seat that holds one', () => {
    const state = withFlor();
    expect(canDo(state, 'human', 'flor')).toBe(true);
    expect(getPlayerView(state, 'human').iHaveFlor).toBe(true);
    expect(getPlayerView(state, 'ai').iHaveFlor).toBe(false);
  });

  it('pays 3 straight away when the other seat has no flor', () => {
    const state = run(withFlor(), [['human', { type: 'flor' }]]);
    expect(state.flor.resolved).toEqual({ winner: 'human', points: 3, wanted: false });
    expect(state.scores.human).toBe(3);
    // Play resumes with the announcer still owing a card.
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('human');
  });

  it('is optional: a seat may stay quiet and forfeit the points', () => {
    const state = run(withFlor(), [['human', playOf(c(7, 'oro'))]]);
    expect(state.flor.resolved).toBeNull();
    expect(state.scores.human).toBe(0);
    expect(canDo(state, 'human', 'flor')).toBe(false);
  });

  it('cannot be announced after the first trick', () => {
    const state = run(withFlor(), [
      ['human', playOf(c(7, 'oro'))],
      ['ai', playOf(c(5, 'espada'))],
    ]);
    expect(canDo(state, 'human', 'flor')).toBe(false);
  });

  it('cannot be announced twice', () => {
    const state = run(withFlor(), [['human', { type: 'flor' }]]);
    expect(canDo(state, 'human', 'flor')).toBe(false);
  });
});

describe('flor annuls the envido', () => {
  it('a seat holding a flor may not call envido', () => {
    const state = withFlor();
    expect(canDo(state, 'human', 'envido')).toBe(false);
    expect(canDo(state, 'human', 'realEnvido')).toBe(false);
    expect(canDo(state, 'human', 'faltaEnvido')).toBe(false);
    expect(canDo(state, 'human', 'flor')).toBe(true);
  });

  it('answering an envido with a flor drops the envido without paying it', () => {
    // The ai (no flor) opens the envido; the human answers with flor.
    let state = run(withFlor({ mano: 'ai' }), [['ai', { type: 'envido' }]]);
    expect(legalTypes(state, 'human')).toContain('flor');

    state = run(state, [['human', { type: 'flor' }]]);
    expect(state.envido.resolved).toBeNull();
    expect(state.envido.pending).toBeNull();
    expect(state.flor.resolved).toEqual({ winner: 'human', points: 3, wanted: false });
    expect(state.scores.human).toBe(3);
    expect(state.scores.ai).toBe(0);
    // The ai still owes its card.
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('ai');
  });

  it('closes the envido for the rest of the hand', () => {
    // Human announces the flor, plays, and the ai -- which has no flor and has not
    // played yet -- still cannot open an envido.
    const state = run(withFlor(), [
      ['human', { type: 'flor' }],
      ['human', playOf(c(7, 'oro'))],
    ]);
    expect(state.turn).toBe('ai');
    expect(canDo(state, 'ai', 'envido')).toBe(false);
    expect(state.flor.announced).toEqual(['human']);
  });
});

describe('flor against flor', () => {
  const contest = (over: Partial<ScenarioOptions> = {}) =>
    buildState({
      human: FLOR_BIG,
      ai: FLOR_SMALL,
      mano: 'human',
      ...over,
      config: { flor: true, ...over.config },
    });

  it('becomes a contest the other seat must answer', () => {
    const state = run(contest(), [['human', { type: 'flor' }]]);
    expect(state.phase).toBe('florResponse');
    expect(state.turn).toBe('ai');
    expect(state.flor.pending).toEqual({ by: 'human', call: 'flor' });
    expect(state.flor.announced.sort()).toEqual(['ai', 'human']);
    expect(legalTypes(state, 'ai').sort()).toEqual(
      ['contraflor', 'contraflorAlResto', 'noQuiero', 'quiero'].sort(),
    );
  });

  it('"con flor me achico" pays the caller 3', () => {
    const state = run(contest(), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'noQuiero' }],
    ]);
    expect(state.flor.resolved).toEqual({ winner: 'human', points: 3, wanted: false });
    expect(state.scores.human).toBe(3);
  });

  it('accepted, the higher count takes 3', () => {
    const state = run(contest(), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'quiero' }],
    ]);
    // 38 of oro beats 29 of copa.
    expect(state.flor.resolved).toEqual({ winner: 'human', points: 3, wanted: true });
    expect(
      state.log
        .filter((event) => event.type === 'pointsDeclared')
        .map((event) => (event.type === 'pointsDeclared' ? event.points : 0)),
    ).toEqual([38, 29]);
  });

  it('the higher count wins even when the mano is the weaker hand', () => {
    const state = run(contest({ human: FLOR_SMALL, ai: FLOR_BIG }), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'quiero' }],
    ]);
    expect(state.flor.resolved?.winner).toBe('ai');
  });

  it('a tie goes to the mano', () => {
    const state = run(
      contest({
        human: [c(7, 'oro'), c(6, 'oro'), c(5, 'oro')],
        ai: [c(7, 'copa'), c(6, 'copa'), c(5, 'copa')],
        mano: 'ai',
      }),
      [
        ['ai', { type: 'flor' }],
        ['human', { type: 'quiero' }],
      ],
    );
    expect(state.flor.resolved?.winner).toBe('ai');
  });

  it('contraflor accepted is worth 6, refused 3', () => {
    const accepted = run(contest(), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'contraflor' }],
      ['human', { type: 'quiero' }],
    ]);
    expect(accepted.flor.resolved).toEqual({ winner: 'human', points: 6, wanted: true });

    const refused = run(contest(), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'contraflor' }],
      ['human', { type: 'noQuiero' }],
    ]);
    expect(refused.flor.resolved).toEqual({ winner: 'ai', points: 3, wanted: false });
  });

  it('contraflor al resto is worth the falta, and refusing it pays the chain', () => {
    const accepted = run(contest({ scores: { human: 12, ai: 22 } }), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'contraflorAlResto' }],
      ['human', { type: 'quiero' }],
    ]);
    expect(accepted.flor.resolved?.points).toBe(30 - 22);

    const afterContraflor = run(contest(), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'contraflor' }],
      ['human', { type: 'contraflorAlResto' }],
      ['ai', { type: 'noQuiero' }],
    ]);
    expect(afterContraflor.flor.resolved).toEqual({ winner: 'human', points: 6, wanted: false });
  });

  it('closes the ladder after the resto', () => {
    const state = run(contest(), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'contraflorAlResto' }],
    ]);
    expect(legalTypes(state, 'human').sort()).toEqual(['noQuiero', 'quiero']);
  });

  it('can take the game outright', () => {
    const state = run(contest({ scores: { human: 28, ai: 4 } }), [
      ['human', { type: 'flor' }],
      ['ai', { type: 'contraflor' }],
      ['human', { type: 'quiero' }],
    ]);
    expect(state.scores.human).toBe(34);
    expect(state.winner).toBe('human');
    expect(state.lastHandResult).toEqual({ winner: 'human', points: 6, reason: 'target' });
  });
});

describe('flor and truco together', () => {
  it('the flor is settled first, then the parked truco', () => {
    let state = run(withFlor({ mano: 'ai' }), [['ai', { type: 'truco' }]]);
    expect(legalTypes(state, 'human')).toContain('flor');

    state = run(state, [['human', { type: 'flor' }]]);
    expect(state.scores.human).toBe(3);
    // The truco is back on the table, awaiting the human's answer.
    expect(state.phase).toBe('trucoResponse');
    expect(state.truco.pending).toEqual({ by: 'ai', call: 'truco' });
    expect(state.turn).toBe('human');

    state = run(state, [['human', { type: 'quiero' }]]);
    expect(state.truco.level).toBe(1);
    expect(state.turn).toBe('ai');
  });
});

describe('end-of-hand flor reveal', () => {
  it('shows the three cards of the winning flor', () => {
    let state = run(withFlor(), [['human', { type: 'flor' }]]);
    state = run(state, [['human', { type: 'irseAlMazo' }]]);
    expect(state.revealed.human.map(cardId).sort()).toEqual(['5-oro', '6-oro', '7-oro']);
    expect(getPlayerView(state, 'ai').knownOpponentCards.map(cardId).sort()).toEqual([
      '5-oro',
      '6-oro',
      '7-oro',
    ]);
  });

  it('shows nothing for the loser of the flor', () => {
    let state = run(
      buildState({
        human: FLOR_BIG,
        ai: FLOR_SMALL,
        mano: 'human',
        config: { flor: true },
      }),
      [
        ['human', { type: 'flor' }],
        ['ai', { type: 'quiero' }],
      ],
    );
    state = run(state, [['human', { type: 'irseAlMazo' }]]);
    expect(state.revealed.ai).toEqual([]);
    expect(getPlayerView(state, 'human').knownOpponentCards).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DIFFICULTIES,
  actionKey,
  cardId,
  defaultConfig,
  seededRng,
  type Card,
  type Difficulty,
  type PlayerId,
  type PlayerView,
} from '@truco/shared';
import {
  applyAction,
  buildState,
  createGame,
  getLegalActions,
  getPlayerView,
  type GameState,
} from '@truco/engine';
import { decide, evaluateActions, randomPolicy, thinkingDelayMs } from './decide.js';
import type { AIConfig } from './config.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

const cfg = (difficulty: Difficulty, seed = 1, over: Partial<AIConfig> = {}): AIConfig => ({
  difficulty,
  rng: seededRng(seed),
  budgetMs: Infinity,
  ...over,
});

/**
 * Walk a whole game, asking the AI to move for whichever seat is on turn, and run
 * `inspect` on every decision.
 */
function walkGame(
  difficulty: Difficulty,
  seed: number,
  inspect: (view: PlayerView, action: ReturnType<typeof decide>, state: GameState) => void,
  over: Partial<AIConfig> = {},
): GameState {
  const rng = seededRng(seed);
  const config = cfg(difficulty, seed + 1, over);
  let state = createGame(defaultConfig(), rng);
  let guard = 0;
  while (state.winner === null) {
    if (guard++ > 4_000) throw new Error('game failed to terminate');
    const seat: PlayerId = state.phase === 'handOver' ? state.mano : state.turn;
    const view = getPlayerView(state, seat);
    const action = decide(view, config);
    inspect(view, action, state);
    state = applyAction(state, seat, action, rng);
  }
  return state;
}

describe('decide only ever returns a legal action', () => {
  it.each(DIFFICULTIES)('holds for %s across whole games', (difficulty) => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 28 }), (seed) => {
        // A tight budget here: this property is about legality, not strength.
        walkGame(
          difficulty,
          seed,
          (view, action) => {
            const keys = view.legalActions.map(actionKey);
            expect(keys).toContain(actionKey(action));
          },
          { budgetMs: 5 },
        );
      }),
      { numRuns: 25 },
    );
  });

  it('never throws, in any phase, over many games', () => {
    const phases = new Set<string>();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 28 }), (seed) => {
        walkGame('dificil', seed, (view) => phases.add(view.phase), { budgetMs: 5 });
      }),
      { numRuns: 8 },
    );
    // The walk really did exercise the interesting phases, not just card play.
    expect(phases).toContain('playing');
    expect(phases).toContain('trucoResponse');
    expect(phases).toContain('envidoResponse');
    expect(phases).toContain('envidoDeclaring');
    expect(phases).toContain('handOver');
  });

  it('refuses to move when there is nothing legal to do', () => {
    const state = buildState({
      human: [c(1, 'espada'), c(2, 'oro'), c(4, 'copa')],
      ai: [c(1, 'basto'), c(3, 'oro'), c(5, 'copa')],
      mano: 'human',
    });
    // It is the human's turn, so the ai seat has no legal action at all.
    const view = getPlayerView(state, 'ai');
    expect(view.legalActions).toEqual([]);
    expect(() => decide(view, cfg('normal'))).toThrow(/no legal actions/);
  });
});

describe('the ai cannot see the opponent cards', () => {
  /**
   * The decisive test. Two genuinely different games -- different cards in the
   * human's hand -- that look identical from the ai's seat must produce the identical
   * decision. If any hidden card reached the AI, these would diverge.
   */
  const aiHand = [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')];

  const sameViewStates = (): [GameState, GameState] => [
    buildState({
      human: [c(1, 'espada'), c(2, 'basto'), c(5, 'copa')],
      ai: aiHand,
      mano: 'ai',
    }),
    buildState({
      human: [c(4, 'basto'), c(10, 'espada'), c(11, 'copa')],
      ai: aiHand,
      mano: 'ai',
    }),
  ];

  it('produces identical views for the ai seat', () => {
    const [first, second] = sameViewStates();
    expect(JSON.stringify(getPlayerView(first, 'ai'))).toBe(
      JSON.stringify(getPlayerView(second, 'ai')),
    );
  });

  it.each(DIFFICULTIES)('decides identically for %s, whatever the opponent holds', (difficulty) => {
    const [first, second] = sameViewStates();
    for (let seed = 1; seed <= 12; seed++) {
      const a = decide(getPlayerView(first, 'ai'), cfg(difficulty, seed));
      const b = decide(getPlayerView(second, 'ai'), cfg(difficulty, seed));
      expect(actionKey(a)).toBe(actionKey(b));
    }
  });

  it('values every action identically, not just the chosen one', () => {
    const [first, second] = sameViewStates();
    const a = evaluateActions(getPlayerView(first, 'ai'), cfg('dificil', 3));
    const b = evaluateActions(getPlayerView(second, 'ai'), cfg('dificil', 3));
    expect(a.map((entry) => [actionKey(entry.action), entry.value])).toEqual(
      b.map((entry) => [actionKey(entry.action), entry.value]),
    );
  });

  it('is handed a view with no hidden opponent card, at every decision', () => {
    walkGame('dificil', 404, (view, _action, state) => {
      const opponent = view.opponent;
      const publicIds = new Set<string>();
      for (const trick of state.tricks) {
        for (const play of trick.plays) {
          if (play.player === opponent) publicIds.add(cardId(play.card));
        }
      }
      for (const card of state.revealed[opponent]) publicIds.add(cardId(card));

      const json = JSON.stringify(view);
      for (const card of state.dealt[opponent]) {
        if (publicIds.has(cardId(card))) continue;
        expect(json).not.toContain(`"rank":${card.rank},"suit":"${card.suit}"`);
        expect(json).not.toContain(`"${cardId(card)}"`);
      }
    });
  });
});

describe('reading the table', () => {
  it('never folds a 33, and never pays to see a 0', () => {
    const strong = buildState({
      human: [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')],
      ai: [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')],
      mano: 'human',
    });
    const weak = buildState({
      human: [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')],
      ai: [c(10, 'oro'), c(11, 'basto'), c(12, 'copa')],
      mano: 'human',
    });
    const rng = seededRng(1);
    const afterCall = (state: GameState) => applyAction(state, 'human', { type: 'envido' }, rng);

    // With 33 it either takes the envido or raises -- what it must not do is fold.
    // With 0 it may fold or bluff-raise (a real move, and +EV against a folding
    // opponent) -- what it must not do is pay to show a losing count.
    for (let seed = 1; seed <= 12; seed++) {
      const withStrong = decide(getPlayerView(afterCall(strong), 'ai'), cfg('dificil', seed));
      expect(withStrong.type).not.toBe('noQuiero');
      const withWeak = decide(getPlayerView(afterCall(weak), 'ai'), cfg('dificil', seed));
      expect(withWeak.type).not.toBe('quiero');
    }
  });

  it('declares its points when they are the higher ones', () => {
    let state = buildState({
      human: [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')], // 27
      ai: [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')], // 33
      mano: 'human',
    });
    const rng = seededRng(1);
    state = applyAction(state, 'human', { type: 'envido' }, rng);
    state = applyAction(state, 'ai', { type: 'quiero' }, rng);
    state = applyAction(state, 'human', { type: 'declarePoints' }, rng);
    const action = decide(getPlayerView(state, 'ai'), cfg('normal'));
    expect(action.type).toBe('declarePoints');
  });

  it('says "son buenas" rather than giving its number away when it is behind', () => {
    let state = buildState({
      human: [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')], // 33
      ai: [c(10, 'espada'), c(11, 'basto'), c(12, 'copa')], // 0
      mano: 'human',
    });
    const rng = seededRng(1);
    state = applyAction(state, 'human', { type: 'envido' }, rng);
    state = applyAction(state, 'ai', { type: 'quiero' }, rng);
    state = applyAction(state, 'human', { type: 'declarePoints' }, rng);
    const action = decide(getPlayerView(state, 'ai'), cfg('normal'));
    expect(action.type).toBe('sonBuenas');
    // Same outcome either way, so this costs nothing and reveals less.
    const after = applyAction(state, 'ai', action, rng);
    expect(after.envido.resolved?.winner).toBe('human');
  });

  it('takes a free flor without being asked twice', () => {
    const state = buildState({
      human: [c(5, 'espada'), c(2, 'basto'), c(12, 'copa')],
      ai: [c(7, 'oro'), c(6, 'oro'), c(5, 'oro')],
      mano: 'ai',
      config: { flor: true },
    });
    const action = decide(getPlayerView(state, 'ai'), cfg('normal', 2));
    expect(action.type).toBe('flor');
  });
});

describe('human-like behaviour', () => {
  it('does not always make the same call with the same cards', () => {
    const state = buildState({
      human: [c(5, 'espada'), c(2, 'basto'), c(12, 'copa')],
      ai: [c(1, 'espada'), c(1, 'basto'), c(7, 'espada')],
      mano: 'ai',
    });
    const view = getPlayerView(state, 'ai');
    const chosen = new Set(
      Array.from({ length: 30 }, (_, seed) => actionKey(decide(view, cfg('dificil', seed + 1)))),
    );
    // A monster hand sometimes gets called and sometimes gets played quietly.
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('bluffs with a bad hand often enough to be unreadable', () => {
    const state = buildState({
      human: [c(1, 'espada'), c(1, 'basto'), c(7, 'espada')],
      ai: [c(4, 'copa'), c(5, 'basto'), c(4, 'oro')],
      mano: 'ai',
    });
    const view = getPlayerView(state, 'ai');
    const calls = Array.from({ length: 60 }, (_, seed) =>
      decide(view, cfg('normal', seed + 1)),
    ).filter((action) => action.type === 'truco' || action.type === 'envido');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('thinks for between 300ms and 1800ms, longer on harder spots', () => {
    const state = buildState({
      human: [c(5, 'espada'), c(2, 'basto'), c(12, 'copa')],
      ai: [c(1, 'espada'), c(1, 'basto'), c(7, 'espada')],
      mano: 'ai',
    });
    const view = getPlayerView(state, 'ai');
    const rng = seededRng(9);
    for (let i = 0; i < 50; i++) {
      const delay = thinkingDelayMs(view, cfg('dificil'), rng);
      expect(delay).toBeGreaterThanOrEqual(600);
      expect(delay).toBeLessThanOrEqual(1_800);
    }
    // A forced move comes back almost instantly.
    const forced: PlayerView = { ...view, legalActions: [view.legalActions[0]!] };
    expect(thinkingDelayMs(forced, cfg('dificil'), rng)).toBeLessThan(600);
  });
});

describe('randomPolicy', () => {
  it('picks a legal action', () => {
    const state = buildState({
      human: [c(1, 'espada'), c(2, 'oro'), c(4, 'copa')],
      ai: [c(1, 'basto'), c(3, 'oro'), c(5, 'copa')],
      mano: 'human',
    });
    const view = getPlayerView(state, 'human');
    const rng = seededRng(4);
    for (let i = 0; i < 40; i++) {
      expect(getLegalActions(state, 'human').map(actionKey)).toContain(
        actionKey(randomPolicy(view, rng)),
      );
    }
  });

  it('refuses when there is nothing to do', () => {
    const state = buildState({
      human: [c(1, 'espada'), c(2, 'oro'), c(4, 'copa')],
      ai: [c(1, 'basto'), c(3, 'oro'), c(5, 'copa')],
      mano: 'human',
    });
    expect(() => randomPolicy(getPlayerView(state, 'ai'), seededRng(1))).toThrow(/no legal/);
  });
});

describe('the time budget', () => {
  it('cuts the search short but still returns a legal move', () => {
    const state = buildState({
      human: [c(5, 'espada'), c(2, 'basto'), c(12, 'copa')],
      ai: [c(1, 'espada'), c(1, 'basto'), c(7, 'espada')],
      mano: 'ai',
    });
    const view = getPlayerView(state, 'ai');
    const values = evaluateActions(view, cfg('dificil', 1, { budgetMs: 0 }));
    // At least one sample always completes, however tight the budget.
    expect(values.every((entry) => entry.samples >= 1)).toBe(true);
    expect(Math.max(...values.map((entry) => entry.samples))).toBeLessThan(120);
    expect(view.legalActions.map(actionKey)).toContain(
      actionKey(decide(view, cfg('dificil', 1, { budgetMs: 0 }))),
    );
  });
});

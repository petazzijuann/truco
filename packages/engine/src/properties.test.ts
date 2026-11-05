import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DECK_SIZE,
  GameConfigSchema,
  PLAYER_IDS,
  cardId,
  seededRng,
  type Action,
  type GameConfig,
  type PlayerId,
} from '@truco/shared';
import { applyAction } from './apply.js';
import { envidoPoints } from './envido.js';
import { checkInvariants } from './invariants.js';
import { getLegalActions } from './legal.js';
import { getPlayerView } from './playerView.js';
import { createGame, type GameState } from './state.js';

/** The most actions a sane game should ever need; a higher count means we failed to terminate. */
const ACTION_BUDGET = 4_000;

const configArb = fc
  .record({
    target: fc.constantFrom(15, 30),
    faltaEnvidoMode: fc.constantFrom('classic', 'simple'),
    mazoPrimeraPenalty: fc.boolean(),
    flor: fc.boolean(),
  })
  .map((partial) => GameConfigSchema.parse(partial));

type Observation = { state: GameState; player: PlayerId; action: Action };

/**
 * Play a whole game out, choosing uniformly among legal actions, and call `observe`
 * after every transition. Returns the number of actions it took.
 */
function playRandomGame(
  seed: number,
  config: GameConfig,
  observe: (observation: Observation) => void,
): { state: GameState; actions: number } {
  const rng = seededRng(seed);
  let state = createGame(config, rng);
  let actions = 0;

  while (state.winner === null) {
    if (actions++ > ACTION_BUDGET) throw new Error('game failed to terminate');
    // At `handOver` either seat may ask for the next deal; otherwise it is strictly on turn.
    const player: PlayerId = state.phase === 'handOver' ? state.mano : state.turn;
    const legal = getLegalActions(state, player);
    expect(legal.length).toBeGreaterThan(0);
    const action = legal[rng.int(legal.length)]!;
    state = applyAction(state, player, action, rng);
    observe({ state, player, action });
  }

  return { state, actions };
}

describe('invariants over randomly played games', () => {
  it('never corrupts the deck, the hands or the scoreboard', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), configArb, (seed, config) => {
        let previous = { human: 0, ai: 0 };
        const { state } = playRandomGame(seed, config, ({ state: current }) => {
          const problems = checkInvariants(current);
          expect(problems).toEqual([]);
          // The scoreboard only ever goes up.
          for (const player of PLAYER_IDS) {
            expect(current.scores[player]).toBeGreaterThanOrEqual(previous[player]);
          }
          previous = { ...current.scores };
        });

        expect(state.winner).not.toBeNull();
        expect(state.scores[state.winner!]).toBeGreaterThanOrEqual(config.target);
        expect(state.phase).toBe('gameOver');
      }),
      { numRuns: 400 },
    );
  });

  it('always terminates, in a plausible number of moves', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        const { actions } = playRandomGame(seed, GameConfigSchema.parse({ flor: true }), () => {});
        expect(actions).toBeLessThan(ACTION_BUDGET);
      }),
      { numRuns: 600 },
    );
  });

  it('only ever offers a seat its own cards', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        playRandomGame(seed, GameConfigSchema.parse({}), ({ state }) => {
          for (const player of PLAYER_IDS) {
            const own = new Set(state.hands[player].map(cardId));
            for (const action of getLegalActions(state, player)) {
              if (action.type === 'playCard') expect(own.has(action.card)).toBe(true);
            }
          }
        });
      }),
      { numRuns: 150 },
    );
  });

  it('never lets a seat play a card that was not dealt to it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        playRandomGame(seed, GameConfigSchema.parse({}), ({ state, player, action }) => {
          if (action.type !== 'playCard') return;
          const dealtToPlayer = state.dealt[player].map(cardId);
          expect(dealtToPlayer).toContain(action.card);
        });
      }),
      { numRuns: 150 },
    );
  });

  it('never lets a declared envido count differ from the real hand', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        playRandomGame(seed, GameConfigSchema.parse({}), ({ state }) => {
          for (const declaration of state.envido.declarations) {
            if (declaration.points === 'buenas') continue;
            expect(declaration.points).toBe(envidoPoints(state.dealt[declaration.player]));
          }
        });
      }),
      { numRuns: 150 },
    );
  });
});

describe('getPlayerView never leaks', () => {
  it('keeps hidden opponent cards out of the serialised view, always', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), configArb, (seed, config) => {
        playRandomGame(seed, config, ({ state }) => {
          for (const me of PLAYER_IDS) {
            const opponent: PlayerId = me === 'human' ? 'ai' : 'human';

            // Cards the opponent has legitimately made public.
            const publicIds = new Set<string>();
            for (const trick of state.tricks) {
              for (const play of trick.plays) {
                if (play.player === opponent) publicIds.add(cardId(play.card));
              }
            }
            for (const card of state.revealed[opponent]) publicIds.add(cardId(card));

            const json = JSON.stringify(getPlayerView(state, me));
            for (const card of state.dealt[opponent]) {
              const id = cardId(card);
              if (publicIds.has(id)) continue;
              // Neither the id form nor the structural form may appear.
              expect(json).not.toContain(`"${id}"`);
              expect(json).not.toContain(`"rank":${card.rank},"suit":"${card.suit}"`);
            }
          }
        });
      }),
      { numRuns: 150 },
    );
  });

  it('reports an opponent card count consistent with the 40-card deck', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 30 }), (seed) => {
        playRandomGame(seed, GameConfigSchema.parse({}), ({ state }) => {
          for (const me of PLAYER_IDS) {
            const view = getPlayerView(state, me);
            const opponent: PlayerId = me === 'human' ? 'ai' : 'human';
            expect(view.opponentCardCount).toBe(state.hands[opponent].length);
            // What the viewer can account for never exceeds the deck.
            const accountedFor = view.myDealtHand.length + 3 + state.undealt.length;
            expect(accountedFor).toBe(DECK_SIZE);
          }
        });
      }),
      { numRuns: 120 },
    );
  });
});

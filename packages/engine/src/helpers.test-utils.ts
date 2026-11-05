import { cardId, seededRng, type Action, type Card, type PlayerId, type Rng } from '@truco/shared';
import { applyAction } from './apply.js';
import { getLegalActions } from './legal.js';
import type { GameState } from './state.js';

export const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

export const testRng = (seed = 1): Rng => seededRng(seed);

/** Apply a sequence of `[player, action]` steps, failing loudly on the first illegal one. */
export function run(
  state: GameState,
  steps: readonly (readonly [PlayerId, Action])[],
  rng: Rng = testRng(),
): GameState {
  return steps.reduce(
    (current, [player, action]) => applyAction(current, player, action, rng),
    state,
  );
}

export const legalTypes = (state: GameState, player: PlayerId): string[] =>
  getLegalActions(state, player).map((action) =>
    action.type === 'playCard' ? `playCard:${action.card}` : action.type,
  );

export const canDo = (state: GameState, player: PlayerId, type: Action['type']): boolean =>
  getLegalActions(state, player).some((action) => action.type === type);

export const playOf = (card: Card): Action => ({ type: 'playCard', card: cardId(card) });

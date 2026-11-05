import {
  opponentOf,
  type Action,
  type Card,
  type PlayerId,
  type Rng,
  type TrickOutcome,
} from '@truco/shared';
import {
  applyAction,
  envidoPoints,
  florPoints,
  getLegalActions,
  handStrength,
  strengthOf,
  type GameState,
} from '@truco/engine';

const minBy = (cards: readonly Card[]): Card =>
  cards.reduce((best, card) => (strengthOf(card) < strengthOf(best) ? card : best));

const maxBy = (cards: readonly Card[]): Card =>
  cards.reduce((best, card) => (strengthOf(card) > strengthOf(best) ? card : best));

/** Tricks won minus tricks lost, from `player`'s side. */
function trickBalance(state: GameState, player: PlayerId): number {
  const outcomes = state.tricks
    .map((trick) => trick.outcome)
    .filter((outcome): outcome is TrickOutcome => outcome !== null);
  let balance = 0;
  for (const outcome of outcomes) {
    if (outcome === player) balance += 1;
    else if (outcome !== 'parda') balance -= 1;
  }
  return balance;
}

/**
 * How good this seat's position looks, in roughly `[0, 1]`: the raw strength of the
 * cards still in hand, nudged by how the tricks have gone so far.
 */
export function positionStrength(state: GameState, player: PlayerId): number {
  const cards = handStrength(state.hands[player]);
  return Math.max(0, Math.min(1, cards + 0.18 * trickBalance(state, player)));
}

/** Accept thresholds for the truco ladder: the bigger the pot, the better the hand must be. */
const TRUCO_ACCEPT_THRESHOLD: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.33, 2: 0.46, 3: 0.56 };

/**
 * Accept with a probability that rises smoothly through the threshold, rather than
 * flipping at it.
 *
 * This matters more than it looks. A play-out opponent that folds deterministically
 * below some number is trivially exploitable, and the search *will* exploit it: it
 * would learn that re-raising with nothing is free money. Blurring the threshold
 * makes the simulated opponent uncertain, which is what a real one is.
 */
function softAccept(margin: number, slope: number, rng: Rng): boolean {
  const p = Math.max(0.05, Math.min(0.95, 0.5 + margin * slope));
  return rng.int(1_000) < p * 1_000;
}

/**
 * The fast policy used inside rollouts. It is intentionally simple and greedy: PIMC
 * gets its strength from sampling many hands, not from deep play-outs, and a cheap
 * policy is what makes the sampling affordable.
 *
 * Its responses are deliberately probabilistic, so the search cannot discover and
 * farm a fixed folding threshold.
 */
export function rolloutAction(state: GameState, player: PlayerId, rng: Rng): Action {
  const legal = getLegalActions(state, player);
  /* v8 ignore next -- the caller only asks when there is something to do */
  if (legal.length === 0) throw new Error(`no legal action for ${player}`);
  const find = (type: Action['type']): Action | undefined =>
    legal.find((action) => action.type === type);

  switch (state.phase) {
    case 'envidoDeclaring': {
      // Stating the real count is never worse than conceding, so always do it.
      return find('declarePoints') ?? legal[0]!;
    }

    case 'florResponse': {
      const accept = softAccept(florPoints(state.dealt[player]) - 31, 0.09, rng);
      return (accept ? find('quiero') : find('noQuiero')) ?? legal[0]!;
    }

    case 'envidoResponse': {
      // Each extra call in the chain demands a couple more points to be worth taking.
      const needed = 22 + 2 * state.envido.chain.length;
      const accept = softAccept(envidoPoints(state.dealt[player]) - needed, 0.07, rng);
      return (accept ? find('quiero') : find('noQuiero')) ?? legal[0]!;
    }

    case 'trucoResponse': {
      const pending = state.truco.pending;
      /* v8 ignore next -- the phase implies a pending call */
      const level = pending === null ? 1 : Math.min(3, state.truco.level + 1);
      const threshold = TRUCO_ACCEPT_THRESHOLD[level as 1 | 2 | 3];
      const accept = softAccept(positionStrength(state, player) - threshold, 2.5, rng);
      return (accept ? find('quiero') : find('noQuiero')) ?? legal[0]!;
    }

    case 'playing': {
      // A flor is free points; take it.
      const flor = find('flor');
      if (flor !== undefined) return flor;

      // Occasionally put money on a strong position. Without this the play-outs
      // would never turn good cards into a bigger pot, and the search would
      // undervalue holding on to a strong hand.
      if (envidoPoints(state.dealt[player]) >= 27 && rng.int(2) === 0) {
        const envido = find('envido') ?? find('realEnvido');
        if (envido !== undefined) return envido;
      }
      if (positionStrength(state, player) >= 0.62 && rng.int(2) === 0) {
        const truco = find('truco') ?? find('retruco') ?? find('valeCuatro');
        if (truco !== undefined) return truco;
      }

      return pickCard(state, player, legal, rng);
    }

    /* v8 ignore next 4 -- rollouts stop before these phases */
    case 'handOver':
    case 'gameOver':
      return legal[0]!;
  }
}

/**
 * Greedy card choice: beat the card on the table with the cheapest card that does,
 * otherwise throw away the weakest; when leading, lead with the strongest.
 */
function pickCard(state: GameState, player: PlayerId, legal: readonly Action[], rng: Rng): Action {
  const playable = legal.filter(
    (action): action is Extract<Action, { type: 'playCard' }> => action.type === 'playCard',
  );
  /* v8 ignore next -- a seat on turn in `playing` always holds a card */
  if (playable.length === 0) return legal[rng.int(legal.length)]!;

  const byId = new Map(state.hands[player].map((card) => [`${card.rank}-${card.suit}`, card]));
  const cards = playable
    .map((action) => byId.get(action.card))
    .filter((card): card is Card => card !== undefined);

  const trick = state.tricks[state.tricks.length - 1];
  const onTable = trick?.plays.find((play) => play.player !== player);

  let chosen: Card;
  if (onTable === undefined) {
    chosen = maxBy(cards);
  } else {
    const winners = cards.filter((card) => strengthOf(card) > strengthOf(onTable.card));
    chosen = winners.length > 0 ? minBy(winners) : minBy(cards);
  }
  return { type: 'playCard', card: `${chosen.rank}-${chosen.suit}` };
}

/** Enough steps for any hand; exceeding it would mean the engine failed to progress. */
const MAX_ROLLOUT_STEPS = 40;

/** Play the current hand out with the fast policy and return the final state. */
export function rollout(state: GameState, rng: Rng): GameState {
  let current = state;
  let steps = 0;
  while (current.phase !== 'handOver' && current.phase !== 'gameOver') {
    /* v8 ignore next -- a hand always terminates */
    if (steps++ > MAX_ROLLOUT_STEPS) throw new Error('rollout failed to terminate');
    current = applyAction(current, current.turn, rolloutAction(current, current.turn, rng), rng);
  }
  return current;
}

/**
 * How much the finished hand was worth to `me`.
 *
 * With `scoreWeighted` the points are measured as a fraction of the distance each
 * seat still had to the target, so three points matter much more at 27-all than at
 * 0-0. Winning or losing the game outright dominates either way.
 */
export function handUtility(
  before: GameState,
  after: GameState,
  me: PlayerId,
  scoreWeighted: boolean,
): number {
  const opponent = opponentOf(me);
  const gainedMe = after.scores[me] - before.scores[me];
  const gainedOpponent = after.scores[opponent] - before.scores[opponent];

  let utility: number;
  if (scoreWeighted) {
    const needMe = Math.max(1, before.config.target - before.scores[me]);
    const needOpponent = Math.max(1, before.config.target - before.scores[opponent]);
    utility = (gainedMe / needMe - gainedOpponent / needOpponent) * 10;
  } else {
    utility = gainedMe - gainedOpponent;
  }

  if (after.winner === me) utility += 8;
  else if (after.winner === opponent) utility -= 8;
  return utility;
}

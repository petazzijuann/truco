import {
  defaultConfig,
  opponentOf,
  type Action,
  type GameConfig,
  type PlayerId,
  type PlayerView,
  type Rng,
} from '@truco/shared';
import { applyAction, createGame, getPlayerView, type GameState } from '@truco/engine';

/** A seat's brain. It sees a `PlayerView` and nothing else -- same contract as `decide`. */
export type Policy = (view: PlayerView) => Action;

export type MatchResult = {
  winner: PlayerId;
  scores: Record<PlayerId, number>;
  hands: number;
  actions: number;
};

/** Enough actions for any sane game; exceeding it means something failed to progress. */
const ACTION_CEILING = 5_000;

/**
 * Play one full game between two policies.
 *
 * Each policy is handed `getPlayerView(state, seat)` -- the identical object the
 * browser receives -- so a benchmark cannot accidentally give one side an advantage.
 */
export function playMatch(
  policies: Record<PlayerId, Policy>,
  rng: Rng,
  config: GameConfig = defaultConfig(),
): MatchResult {
  let state: GameState = createGame(config, rng);
  let actions = 0;

  while (state.winner === null) {
    if (actions++ > ACTION_CEILING) throw new Error('match failed to terminate');
    // At `handOver` either seat may call for the next deal; pick one deterministically.
    const seat: PlayerId = state.phase === 'handOver' ? state.mano : state.turn;
    const action = policies[seat](getPlayerView(state, seat));
    state = applyAction(state, seat, action, rng);
  }

  return {
    winner: state.winner,
    scores: { ...state.scores },
    hands: state.handNumber,
    actions,
  };
}

export type SeriesResult = {
  games: number;
  wins: Record<PlayerId, number>;
  /** Win rate of the policy seated at `human`. */
  rate: number;
  averageHands: number;
};

/**
 * Play a series, swapping seats every other game so that neither policy benefits
 * from always being dealt first.
 */
export function playSeries(
  challenger: Policy,
  incumbent: Policy,
  games: number,
  rng: Rng,
  config: GameConfig = defaultConfig(),
): SeriesResult {
  const wins: Record<PlayerId, number> = { human: 0, ai: 0 };
  let totalHands = 0;

  for (let game = 0; game < games; game++) {
    const challengerSeat: PlayerId = game % 2 === 0 ? 'human' : 'ai';
    const incumbentSeat = opponentOf(challengerSeat);
    const result = playMatch(
      { [challengerSeat]: challenger, [incumbentSeat]: incumbent } as Record<PlayerId, Policy>,
      rng,
      config,
    );
    // Credit the win to the policy, not the seat.
    wins[result.winner === challengerSeat ? 'human' : 'ai'] += 1;
    totalHands += result.hands;
  }

  return {
    games,
    wins,
    rate: wins.human / games,
    averageHands: totalHands / games,
  };
}

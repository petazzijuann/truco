import { actionKey, type Action, type PlayerView, type Rng } from '@truco/shared';
import { applyAction, type GameState } from '@truco/engine';
import { budgetFor, profileFor, type AIConfig, type DifficultyProfile } from './config.js';
import { determinize, sampleOpponentHand } from './determinize.js';
import { handUtility, rollout, rolloutAction } from './rollout.js';

const CALL_TYPES = new Set<Action['type']>([
  'truco',
  'retruco',
  'valeCuatro',
  'envido',
  'realEnvido',
  'faltaEnvido',
  'flor',
  'contraflor',
  'contraflorAlResto',
]);

const isCall = (action: Action): boolean => CALL_TYPES.has(action.type);
const isPlayCard = (action: Action): boolean => action.type === 'playCard';

/** `true` with probability `p`. */
const roll = (rng: Rng, p: number): boolean => rng.int(10_000) < p * 10_000;

/** Uniform in `[-1, 1]`. */
const jitter = (rng: Rng): number => rng.int(2_001) / 1_000 - 1;

export type ActionValue = { action: Action; value: number; samples: number };

/**
 * Perfect-information Monte Carlo: sample hands the opponent could be holding, play
 * each candidate move out in each of those worlds, and average the result.
 *
 * Returns one entry per legal action, highest value first.
 */
export function evaluateActions(view: PlayerView, config: AIConfig): ActionValue[] {
  const profile = profileFor(config);
  const legal = view.legalActions;
  const totals = new Map<string, { action: Action; sum: number; count: number }>();
  for (const action of legal) {
    totals.set(actionKey(action), { action, sum: 0, count: 0 });
  }

  const budget = budgetFor(config);
  const deadline = Number.isFinite(budget) ? Date.now() + budget : Infinity;

  for (let sample = 0; sample < profile.samples; sample++) {
    // Always complete at least one sample, however tight the budget.
    if (sample > 0 && Date.now() > deadline) break;

    const opponentDealt = sampleOpponentHand(view, config.rng);
    const base: GameState = determinize(view, opponentDealt);

    for (const action of legal) {
      const next = applyAction(base, view.me, action, config.rng);
      const final =
        next.phase === 'handOver' || next.phase === 'gameOver' ? next : rollout(next, config.rng);
      const entry = totals.get(actionKey(action))!;
      entry.sum += handUtility(base, final, view.me, profile.scoreWeighted);
      entry.count += 1;
    }
  }

  return [...totals.values()]
    .map(({ action, sum, count }) => ({
      action,
      value: count === 0 ? 0 : sum / count,
      samples: count,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * How much the scoreboard should push towards risk. Being behind buys aggression;
 * sitting one hand from the win buys caution.
 */
export function aggressionFor(view: PlayerView, profile: DifficultyProfile): number {
  const mine = view.scores[view.me];
  const theirs = view.scores[view.opponent];
  const target = view.config.target;
  const behind = (theirs - mine) / target;
  const cushion = Math.max(0, mine / target - 0.8) / 0.2;
  return profile.desperation * (behind - 0.6 * cushion);
}

/**
 * Pick a move.
 *
 * The signature is the whole security argument: a `PlayerView` goes in, an `Action`
 * comes out. There is no parameter through which the full game state could arrive,
 * and the chosen action always comes from `view.legalActions`, so the AI can neither
 * cheat nor make an illegal move.
 */
export function decide(view: PlayerView, config: AIConfig): Action {
  const legal = view.legalActions;
  if (legal.length === 0) {
    throw new Error(`the ai was asked to move with no legal actions (phase ${view.phase})`);
  }
  if (legal.length === 1) return legal[0]!;

  const profile = profileFor(config);

  // Stating the count is never worse than conceding, but when we are plainly behind,
  // "son buenas" gives the same points away while telling the table less.
  if (view.phase === 'envidoDeclaring') return declareOrConcede(view, legal);

  // A beginner's plain mistake.
  if (profile.blunder > 0 && roll(config.rng, profile.blunder)) {
    return legal[config.rng.int(legal.length)]!;
  }

  if (!profile.search) return playByFeel(view, config);

  const ranked = evaluateActions(view, config);
  const aggression = aggressionFor(view, profile);

  const scored = ranked.map(({ action, value }) => ({
    action,
    score: value + profile.noise * 2 * jitter(config.rng) + (isCall(action) ? aggression * 1.5 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  let chosen = scored[0]!.action;

  // Sit on a monster instead of announcing it, to keep the opponent in the hand.
  if (isCall(chosen) && view.myHandStrength > 0.72 && roll(config.rng, profile.trap)) {
    const card = scored.find((entry) => isPlayCard(entry.action));
    if (card !== undefined) chosen = card.action;
  }
  // Or call with nothing at all, so the calls carry no information.
  else if (!isCall(chosen) && view.myHandStrength < 0.38 && roll(config.rng, profile.bluff)) {
    const call = scored.find((entry) => isCall(entry.action));
    if (call !== undefined) chosen = call.action;
  }

  /* v8 ignore next 3 -- every branch above picks out of `legal` */
  if (!legal.some((action) => actionKey(action) === actionKey(chosen))) {
    throw new Error(`the ai produced an action outside the legal set: ${actionKey(chosen)}`);
  }
  return chosen;
}

/**
 * The easy level: guess the opponent's hand once and apply the same greedy policy the
 * rollouts use. No averaging over worlds, so it misreads close spots routinely --
 * which is what a beginner actually does.
 */
function playByFeel(view: PlayerView, config: AIConfig): Action {
  const guess = determinize(view, sampleOpponentHand(view, config.rng));
  const action = rolloutAction(guess, view.me, config.rng);
  const legal = view.legalActions;
  /* v8 ignore next -- the determinization offers this seat exactly `view.legalActions` */
  if (!legal.some((candidate) => actionKey(candidate) === actionKey(action))) return legal[0]!;

  const profile = profileFor(config);
  // Even by feel, a beginner bluffs -- just without a plan.
  if (!isCall(action) && view.myHandStrength < 0.45 && roll(config.rng, profile.bluff)) {
    const call = legal.find(isCall);
    if (call !== undefined) return call;
  }
  return action;
}

function declareOrConcede(view: PlayerView, legal: readonly Action[]): Action {
  const declare = legal.find((action) => action.type === 'declarePoints');
  const concede = legal.find((action) => action.type === 'sonBuenas');
  if (concede === undefined) return declare!;

  const stated = view.envido.declarations
    .filter((entry) => entry.player !== view.me && entry.points !== 'buenas')
    .map((entry) => entry.points as number);
  const best = stated.length === 0 ? -1 : Math.max(...stated);
  // A lower count loses either way, so concede and keep the number to ourselves.
  return view.myEnvidoPoints > best ? declare! : concede;
}

/**
 * How long the AI should appear to think, in milliseconds. Real opponents answer a
 * forced move instantly and dwell on a close call, so the delay tracks how close the
 * decision was rather than being a flat sleep. Applied by the server, not here.
 */
export function thinkingDelayMs(view: PlayerView, config: AIConfig, rng: Rng): number {
  const options = view.legalActions.length;
  if (options <= 1) return 300 + rng.int(200);

  const profile = profileFor(config);
  const base = 600;
  // More choices and a bigger pot read as a harder decision.
  const complexity = Math.min(1, (options - 2) / 6 + view.truco.value / 8);
  const spread = 1_200 * complexity;
  const thinking = base + spread * (0.6 + rng.int(400) / 1_000);
  // Easy plays fast and loose; hard takes its time.
  const scale = profile.scoreWeighted ? 1 : 0.8;
  return Math.round(Math.min(1_800, Math.max(600, thinking * scale)));
}

/** A baseline that picks uniformly among legal moves. Used as the benchmark floor. */
export function randomPolicy(view: PlayerView, rng: Rng): Action {
  const legal = view.legalActions;
  if (legal.length === 0) throw new Error('no legal actions');
  return legal[rng.int(legal.length)]!;
}

import {
  type EnvidoCall,
  type FlorCall,
  type GameConfig,
  type PlayerId,
  type TrucoCall,
  malasThreshold,
} from '@truco/shared';

/* ------------------------------------------------------------------ truco ---- */

export const TRUCO_LEVEL: Readonly<Record<TrucoCall, 1 | 2 | 3>> = {
  truco: 1,
  retruco: 2,
  valeCuatro: 3,
};

export const TRUCO_CALL_AT: Readonly<Record<1 | 2 | 3, TrucoCall>> = {
  1: 'truco',
  2: 'retruco',
  3: 'valeCuatro',
};

/** What the hand is worth if played out at this level. Nothing called means 1. */
export const trucoValue = (level: 0 | 1 | 2 | 3): number => (level === 0 ? 1 : level + 1);

/**
 * What the caller collects on a "no quiero": the value the hand had *before* the
 * refused call. Truco refused pays 1, retruco 2, vale cuatro 3.
 */
export const trucoRejectedValue = (call: TrucoCall): number => TRUCO_LEVEL[call];

/* ----------------------------------------------------------------- envido ---- */

/**
 * Accepted envido values are additive over the chain, which reproduces the whole
 * table: envido 2, envido+envido 4, real envido 3, envido+real 5, envido+envido+real 7.
 * Falta envido contributes nothing here because its value depends on the scoreboard.
 */
const ENVIDO_UNIT: Readonly<Record<EnvidoCall, number>> = {
  envido: 2,
  realEnvido: 3,
  faltaEnvido: 0,
};

const sumChain = (chain: readonly EnvidoCall[]): number =>
  chain.reduce((total, call) => total + ENVIDO_UNIT[call], 0);

export const chainHasFalta = (chain: readonly EnvidoCall[]): boolean =>
  chain.includes('faltaEnvido');

/**
 * Points at stake for the falta envido.
 *
 * `classic`: while the leader is still en las malas the falta is worth the whole
 * game -- the winner jumps straight to the target. Past the halfway mark it is worth
 * whatever the leader still needs to get there.
 *
 * `simple`: always what the leader needs to reach the target.
 */
export function faltaEnvidoValue(
  scores: Readonly<Record<PlayerId, number>>,
  config: GameConfig,
  winner: PlayerId,
): number {
  const leaderScore = Math.max(scores.human, scores.ai);
  if (config.faltaEnvidoMode === 'classic' && leaderScore < malasThreshold(config)) {
    return config.target - scores[winner];
  }
  return config.target - leaderScore;
}

/** What the envido pays the winner once accepted. */
export function envidoAcceptedValue(
  chain: readonly EnvidoCall[],
  scores: Readonly<Record<PlayerId, number>>,
  config: GameConfig,
  winner: PlayerId,
): number {
  if (chainHasFalta(chain)) return faltaEnvidoValue(scores, config, winner);
  return sumChain(chain);
}

/**
 * What the caller collects on a "no quiero": whatever the chain was worth before the
 * refused call, with a floor of 1. So envido refused pays 1, envido+envido pays 2,
 * and "cualquier secuencia + falta envido" pays what that accepted sequence was worth.
 */
export function envidoRejectedValue(chain: readonly EnvidoCall[]): number {
  return Math.max(1, sumChain(chain.slice(0, -1)));
}

/**
 * Which envido-family calls may be stacked on top of the current chain.
 * You cannot go back to a plain envido once a real envido is on the table, you get
 * at most two plain envidos, and falta envido closes the chain.
 */
export function envidoRaises(chain: readonly EnvidoCall[]): EnvidoCall[] {
  if (chainHasFalta(chain)) return [];
  const hasReal = chain.includes('realEnvido');
  const plainCount = chain.filter((call) => call === 'envido').length;
  const raises: EnvidoCall[] = [];
  if (!hasReal && plainCount < 2) raises.push('envido');
  if (!hasReal) raises.push('realEnvido');
  raises.push('faltaEnvido');
  return raises;
}

/* -------------------------------------------------------------------- flor ---- */

/**
 * Flor values. A plain flor is worth 3, contraflor 6, and contraflor al resto is
 * worth the falta -- whatever the leader still needs to close out the game.
 */
export const FLOR_VALUE = 3;
export const CONTRAFLOR_VALUE = 6;

const florChainBase = (chain: readonly FlorCall[]): number =>
  chain.includes('contraflor') ? CONTRAFLOR_VALUE : FLOR_VALUE;

export const chainHasResto = (chain: readonly FlorCall[]): boolean =>
  chain.includes('contraflorAlResto');

export function florAcceptedValue(
  chain: readonly FlorCall[],
  scores: Readonly<Record<PlayerId, number>>,
  config: GameConfig,
  winner: PlayerId,
): number {
  if (chainHasResto(chain)) return faltaEnvidoValue(scores, config, winner);
  return florChainBase(chain);
}

/**
 * What the caller collects when the answer is "con flor me achico" (or any other
 * refusal): whatever the chain was worth before the refused call, never less than 3.
 */
export const florRejectedValue = (chain: readonly FlorCall[]): number =>
  florChainBase(chain.slice(0, -1));

/** Which flor-family calls may be stacked on the current chain. */
export function florRaises(chain: readonly FlorCall[]): FlorCall[] {
  if (chainHasResto(chain)) return [];
  if (chain.includes('contraflor')) return ['contraflorAlResto'];
  if (chain.length === 0) return ['flor'];
  return ['contraflor', 'contraflorAlResto'];
}

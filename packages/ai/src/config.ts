import type { Difficulty, Rng } from '@truco/shared';

/**
 * Knobs for one AI opponent.
 *
 * Note what is *not* here: there is no way to hand the AI a `GameState`. Its only
 * input is the `PlayerView` passed to `decide`, which is the same object a human
 * client receives.
 */
export type AIConfig = {
  difficulty: Difficulty;
  /** Randomness source. Seed it to make a decision reproducible. */
  rng: Rng;
  /**
   * Wall-clock ceiling for the Monte Carlo search. `Infinity` makes the search
   * deterministic for a given seed, which the tests rely on.
   */
  budgetMs?: number;
  /** Override individual profile knobs. Used by the benchmark and by tuning runs. */
  profile?: Partial<DifficultyProfile>;
};

export type DifficultyProfile = {
  /**
   * Whether this level runs the Monte Carlo search at all. Easy does not: it guesses
   * the opponent's hand once and plays by feel, which is a different *kind* of player
   * rather than the same player with a shakier hand.
   */
  search: boolean;
  /** Opponent hands to sample per decision. */
  samples: number;
  /** How much random jitter is added to each action's value before picking the best. */
  noise: number;
  /** Chance of simply picking at random -- a beginner's outright mistake. */
  blunder: number;
  /** Chance of calling with a hand that does not justify it. */
  bluff: number;
  /** Chance of sitting on a very strong hand to trap the opponent instead of calling. */
  trap: number;
  /** Judge points by how much of the remaining distance to the target they cover. */
  scoreWeighted: boolean;
  /** How strongly a losing scoreboard pushes towards aggression. */
  desperation: number;
  defaultBudgetMs: number;
};

/**
 * Easy samples very few hands and decides noisily, so it misreads the table often.
 * Hard samples broadly, weighs the scoreboard, and bluffs on purpose rather than by
 * accident.
 */
export const PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = Object.freeze({
  facil: {
    search: false,
    samples: 1,
    noise: 0.9,
    blunder: 0.18,
    bluff: 0.22,
    trap: 0.04,
    scoreWeighted: false,
    desperation: 0.1,
    defaultBudgetMs: 60,
  },
  normal: {
    search: true,
    samples: 40,
    noise: 0.35,
    blunder: 0.04,
    bluff: 0.16,
    trap: 0.12,
    scoreWeighted: false,
    desperation: 0.3,
    defaultBudgetMs: 250,
  },
  dificil: {
    search: true,
    samples: 120,
    noise: 0.05,
    blunder: 0,
    bluff: 0.1,
    trap: 0.1,
    scoreWeighted: true,
    desperation: 0.25,
    defaultBudgetMs: 600,
  },
});

export const profileFor = (config: AIConfig): DifficultyProfile =>
  config.profile === undefined
    ? PROFILES[config.difficulty]
    : { ...PROFILES[config.difficulty], ...config.profile };

export const budgetFor = (config: AIConfig): number =>
  config.budgetMs ?? profileFor(config).defaultBudgetMs;

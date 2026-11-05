import { z } from 'zod';

export const DIFFICULTIES = ['facil', 'normal', 'dificil'] as const;
export const DifficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof DifficultySchema>;

/**
 * Regional variants of truco disagree on a handful of points. The defaults here are
 * the most widespread Argentine reading; every disputed rule is a switch.
 */
export const GameConfigSchema = z.object({
  /** Game target. 30 points = 15 "malas" + 15 "buenas". */
  target: z.union([z.literal(15), z.literal(30)]).default(30),
  /** Flor is implemented in full but off by default. */
  flor: z.boolean().default(false),
  /**
   * `classic`: falta envido won while the leader is still in the malas wins the whole
   * game; past the halfway mark it is worth whatever the leader needs to reach target.
   * `simple`: always worth what the leader needs to reach target.
   */
  faltaEnvidoMode: z.enum(['classic', 'simple']).default('classic'),
  /** Going to the deck during the first trick, with no envido played, concedes 1 extra point. */
  mazoPrimeraPenalty: z.boolean().default(true),
  difficulty: DifficultySchema.default('normal'),
  playerName: z.string().min(1).max(24).default('Vos'),
});

export type GameConfig = z.infer<typeof GameConfigSchema>;

/**
 * A partial config as it arrives over the wire. Spelled out rather than `Partial`
 * because `exactOptionalPropertyTypes` distinguishes "absent" from "present and
 * undefined", and a JSON payload can carry either.
 */
export type GameConfigPatch = { [K in keyof GameConfig]?: GameConfig[K] | undefined };

export const defaultConfig = (): GameConfig => GameConfigSchema.parse({});

/** Halfway point: below this a player is "en las malas". */
export const malasThreshold = (config: GameConfig): number => config.target / 2;

export const isEnLasMalas = (score: number, config: GameConfig): boolean =>
  score < malasThreshold(config);

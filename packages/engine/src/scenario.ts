import {
  FULL_DECK,
  GameConfigSchema,
  cardId,
  type Card,
  type GameConfig,
  type PlayerId,
} from '@truco/shared';
import { CARDS_PER_HAND } from './deck.js';
import type { GameState } from './state.js';

export type ScenarioOptions = {
  /** Exactly three cards for each seat. */
  human: readonly Card[];
  ai: readonly Card[];
  mano?: PlayerId;
  config?: Partial<GameConfig>;
  scores?: Partial<Record<PlayerId, number>>;
  handNumber?: number;
};

/**
 * Build a game state with known hands, skipping the shuffle.
 *
 * Tests use it to pin down a rule; the AI uses it to turn a sampled opponent hand
 * into a *hypothetical* state it can roll out. Note that the caller must supply both
 * hands -- which is exactly why the AI can only ever build guesses, never the truth.
 */
export function buildState(options: ScenarioOptions): GameState {
  const mano = options.mano ?? 'human';
  const config = GameConfigSchema.parse(options.config ?? {});

  const human = [...options.human];
  const ai = [...options.ai];
  for (const [seat, cards] of [
    ['human', human],
    ['ai', ai],
  ] as const) {
    if (cards.length !== CARDS_PER_HAND) {
      throw new Error(`${seat} needs ${CARDS_PER_HAND} cards, got ${cards.length}`);
    }
  }

  const usedIds = new Set([...human, ...ai].map(cardId));
  if (usedIds.size !== CARDS_PER_HAND * 2) throw new Error('duplicate card across the two hands');
  const undealt = FULL_DECK.filter((card) => !usedIds.has(cardId(card)));

  return {
    config,
    scores: { human: options.scores?.human ?? 0, ai: options.scores?.ai ?? 0 },
    handNumber: options.handNumber ?? 1,
    mano,
    turn: mano,
    playTurn: mano,
    phase: 'playing',
    hands: { human: [...human], ai: [...ai] },
    dealt: { human: [...human], ai: [...ai] },
    undealt: [...undealt],
    tricks: [{ plays: [], outcome: null }],
    truco: { level: 0, pending: null, wordHolder: null },
    envido: { chain: [], pending: null, declarations: [], resolved: null },
    flor: { chain: [], pending: null, announced: [], resolved: null },
    trucoInterrupted: null,
    revealed: { human: [], ai: [] },
    log: [],
    emitted: [],
    seq: 0,
    lastHandResult: null,
    winner: null,
  };
}

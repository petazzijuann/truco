import {
  type Card,
  type EnvidoCall,
  type EnvidoDeclaration,
  type FlorCall,
  type GameConfig,
  type GameEvent,
  type GameEventData,
  type HandResult,
  type PendingCall,
  type Phase,
  type PlayerId,
  type Rng,
  type TrickOutcome,
  type TrucoCall,
  opponentOf,
} from '@truco/shared';
import { CARDS_PER_HAND, deal } from './deck.js';

export type Trick = { plays: { player: PlayerId; card: Card }[]; outcome: TrickOutcome | null };

export type TrucoState = {
  /** Highest accepted level. 0 = nothing called, so the hand is worth 1. */
  level: 0 | 1 | 2 | 3;
  pending: PendingCall<TrucoCall> | null;
  /** Holds "la palabra": the only seat allowed to raise. */
  wordHolder: PlayerId | null;
};

export type EnvidoState = {
  chain: EnvidoCall[];
  pending: PendingCall<EnvidoCall> | null;
  declarations: EnvidoDeclaration[];
  resolved: { winner: PlayerId; points: number; wanted: boolean } | null;
};

export type FlorState = {
  chain: FlorCall[];
  pending: PendingCall<FlorCall> | null;
  announced: PlayerId[];
  resolved: { winner: PlayerId; points: number; wanted: boolean } | null;
};

/**
 * The complete truth about a game, cards included. This type never leaves the
 * server: the only way out is `getPlayerView`, and the AI's `decide` cannot accept
 * it by signature.
 */
export type GameState = {
  readonly config: GameConfig;
  scores: Record<PlayerId, number>;
  handNumber: number;
  /** Mano of the current hand; alternates every deal. */
  mano: PlayerId;
  /** Whoever must act right now. */
  turn: PlayerId;
  /** Whoever must put a card down once every pending call is settled. */
  playTurn: PlayerId;
  phase: Phase;

  /** Unplayed cards still in hand. */
  hands: Record<PlayerId, Card[]>;
  /** The three cards as dealt, kept for envido/flor counting and the end-of-hand reveal. */
  dealt: Record<PlayerId, Card[]>;
  /** The 34 undealt cards. Kept so "40 cards exist" stays a checkable invariant. */
  undealt: Card[];

  tricks: Trick[];
  truco: TrucoState;
  envido: EnvidoState;
  flor: FlorState;
  /** A truco call parked while "el envido está primero" is resolved. */
  trucoInterrupted: PendingCall<TrucoCall> | null;
  /** Cards deliberately shown face-up (the envido winner's count at the end of the hand). */
  revealed: Record<PlayerId, Card[]>;

  /** Event history for the current hand. Public by construction. */
  log: GameEvent[];
  /** Events produced by the action that created this state, for animation. */
  emitted: GameEvent[];
  seq: number;

  lastHandResult: HandResult | null;
  winner: PlayerId | null;
};

const emptyTruco = (): TrucoState => ({ level: 0, pending: null, wordHolder: null });
const emptyEnvido = (): EnvidoState => ({
  chain: [],
  pending: null,
  declarations: [],
  resolved: null,
});
const emptyFlor = (): FlorState => ({ chain: [], pending: null, announced: [], resolved: null });

/** Start a game. The first mano is drawn at random, as at a real table. */
export function createGame(config: GameConfig, rng: Rng): GameState {
  const firstMano: PlayerId = rng.int(2) === 0 ? 'human' : 'ai';
  const state: GameState = {
    config,
    scores: { human: 0, ai: 0 },
    handNumber: 0,
    mano: firstMano,
    turn: firstMano,
    playTurn: firstMano,
    phase: 'playing',
    hands: { human: [], ai: [] },
    dealt: { human: [], ai: [] },
    undealt: [],
    tricks: [],
    truco: emptyTruco(),
    envido: emptyEnvido(),
    flor: emptyFlor(),
    trucoInterrupted: null,
    revealed: { human: [], ai: [] },
    log: [],
    emitted: [],
    seq: 0,
    lastHandResult: null,
    winner: null,
  };
  return dealHand(state, firstMano, rng);
}

/** Deal a fresh hand with `mano` leading. Resets every per-hand piece of state. */
export function dealHand(state: GameState, mano: PlayerId, rng: Rng): GameState {
  const cards = deal(rng);
  const manoCards = cards.first;
  const otherCards = cards.second;
  const other = opponentOf(mano);

  const next: GameState = {
    ...state,
    handNumber: state.handNumber + 1,
    mano,
    turn: mano,
    playTurn: mano,
    phase: 'playing',
    hands: { ...state.hands, [mano]: [...manoCards], [other]: [...otherCards] },
    dealt: { ...state.dealt, [mano]: [...manoCards], [other]: [...otherCards] },
    undealt: [...cards.rest],
    tricks: [{ plays: [], outcome: null }],
    truco: emptyTruco(),
    envido: emptyEnvido(),
    flor: emptyFlor(),
    trucoInterrupted: null,
    revealed: { human: [], ai: [] },
    log: [],
    emitted: [],
  };

  /* v8 ignore next -- deal() already guarantees the sizes */
  if (manoCards.length !== CARDS_PER_HAND) throw new Error('bad deal');

  return emit(next, { type: 'handDealt', handNumber: next.handNumber, mano });
}

/** Append an event to both the hand log and this action's animation batch. */
export function emit(state: GameState, event: GameEventData): GameState {
  const seq = state.seq + 1;
  const full: GameEvent = { ...event, seq };
  return { ...state, seq, log: [...state.log, full], emitted: [...state.emitted, full] };
}

/** Index of the trick in progress, or 3 once the hand is done. */
export const currentTrickIndex = (state: GameState): number => Math.max(0, state.tricks.length - 1);

export const currentTrick = (state: GameState): Trick | undefined =>
  state.tricks[state.tricks.length - 1];

/** Has this seat played any card at all this hand? */
export function hasPlayedThisHand(state: GameState, player: PlayerId): boolean {
  return state.dealt[player].length !== state.hands[player].length;
}

export const completedOutcomes = (state: GameState): TrickOutcome[] =>
  state.tricks
    .map((trick) => trick.outcome)
    .filter((outcome): outcome is TrickOutcome => outcome !== null);

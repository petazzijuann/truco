import type { Action, EnvidoCall, FlorCall, TrucoCall } from './actions.js';
import type { Card } from './cards.js';
import type { GameConfig } from './config.js';
import type { GameEvent, HandEndReason } from './events.js';
import type { PlayerId, TrickOutcome } from './players.js';

export type Phase =
  /** Someone must play a card, raise, or go to the deck. */
  | 'playing'
  /** A truco-family call is on the table and awaits an answer. */
  | 'trucoResponse'
  /** An envido-family call is on the table and awaits an answer. */
  | 'envidoResponse'
  /** Envido was accepted; the players are stating their points. */
  | 'envidoDeclaring'
  /** A flor-family call awaits an answer. */
  | 'florResponse'
  /** The hand is scored; `nextHand` deals again. */
  | 'handOver'
  | 'gameOver';

export type PendingCall<C> = { by: PlayerId; call: C };

export type TrucoView = {
  /** 0 = nothing called (the hand is worth 1), 1 = truco, 2 = retruco, 3 = vale cuatro. */
  level: 0 | 1 | 2 | 3;
  /** Points the hand is currently worth if played out. */
  value: number;
  pending: PendingCall<TrucoCall> | null;
  /** Who holds "la palabra" and may therefore raise. */
  wordHolder: PlayerId | null;
  /**
   * A truco call parked while "el envido está primero" plays out. Public knowledge:
   * everyone at the table heard it and knows it is still owed an answer.
   */
  parked: PendingCall<TrucoCall> | null;
};

export type EnvidoDeclaration = { player: PlayerId; points: number | 'buenas' };

export type EnvidoView = {
  chain: EnvidoCall[];
  pending: PendingCall<EnvidoCall> | null;
  declarations: EnvidoDeclaration[];
  /** Set once the envido has been settled this hand (wanted or not). */
  resolved: { winner: PlayerId; points: number; wanted: boolean } | null;
  /** False once the first trick is over, or once the player has played a card. */
  stillAvailable: boolean;
};

export type FlorView = {
  chain: FlorCall[];
  pending: PendingCall<FlorCall> | null;
  /** Which seats have announced a flor. The opponent's cards stay hidden. */
  announced: PlayerId[];
  resolved: { winner: PlayerId; points: number; wanted: boolean } | null;
};

export type TrickView = {
  plays: { player: PlayerId; card: Card }[];
  outcome: TrickOutcome | null;
};

export type HandResult = { winner: PlayerId; points: number; reason: HandEndReason };

/**
 * Everything one seat is allowed to know, and nothing else. Derived from the full
 * state by `getPlayerView`, which is the only bridge out of the server's game state.
 * The AI consumes exactly this type -- it has no other input.
 */
export type PlayerView = {
  me: PlayerId;
  opponent: PlayerId;
  config: GameConfig;

  scores: Record<PlayerId, number>;
  handNumber: number;
  mano: PlayerId;
  turn: PlayerId;
  /** Who owes a card once every pending call is settled. Public knowledge. */
  playTurn: PlayerId;
  phase: Phase;

  /** My own unplayed cards. */
  myHand: Card[];
  /** My three cards as dealt, including ones I already played. */
  myDealtHand: Card[];
  /** My envido points. Mine only -- computed from my own cards. */
  myEnvidoPoints: number;
  /** Rough strength of my own hand in `[0, 1]`, for the optional help mode. */
  myHandStrength: number;
  /** Do I have flor? Only meaningful when flor is enabled. */
  iHaveFlor: boolean;

  /** How many cards the opponent still holds. Never which ones. */
  opponentCardCount: number;
  /** Opponent cards that became public: played face-up, or revealed by a won envido. */
  knownOpponentCards: Card[];

  tricks: TrickView[];
  /** Index of the trick in progress (0-2), or 3 when the hand is over. */
  currentTrick: number;

  truco: TrucoView;
  envido: EnvidoView;
  flor: FlorView;

  /** The only legal moves right now. Empty when it is not my turn. */
  legalActions: Action[];
  log: GameEvent[];

  lastHandResult: HandResult | null;
  winner: PlayerId | null;
};

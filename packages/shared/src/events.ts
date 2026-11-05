import type { CardId } from './cards.js';
import type { PlayerId, TrickOutcome } from './players.js';
import type { EnvidoCall, FlorCall, TrucoCall } from './actions.js';

export type HandEndReason =
  /** Decided by the three tricks. */
  | 'tricks'
  /** Someone said "no quiero" to truco/retruco/vale cuatro. */
  | 'trucoRejected'
  /** Someone went to the deck. */
  | 'mazo'
  /** The game target was reached mid-hand (by envido or flor). */
  | 'target';

/**
 * Events are the animation and history channel. Every event is *public by
 * construction*: it only ever names cards that have been played face-up or
 * deliberately revealed, so the exact same stream is safe to hand to both seats.
 */
export type GameEventData =
  | { type: 'handDealt'; handNumber: number; mano: PlayerId }
  | { type: 'cardPlayed'; player: PlayerId; card: CardId; trick: number }
  | { type: 'trickResolved'; trick: number; outcome: TrickOutcome }
  | { type: 'called'; player: PlayerId; call: TrucoCall | EnvidoCall | FlorCall }
  | { type: 'responded'; player: PlayerId; response: 'quiero' | 'noQuiero' }
  | { type: 'pointsDeclared'; player: PlayerId; points: number }
  | { type: 'sonBuenas'; player: PlayerId }
  | { type: 'envidoResolved'; winner: PlayerId; points: number; wanted: boolean }
  | { type: 'florResolved'; winner: PlayerId; points: number; wanted: boolean }
  | { type: 'cardsRevealed'; player: PlayerId; cards: CardId[]; reason: 'envido' | 'flor' }
  | { type: 'wentToDeck'; player: PlayerId }
  | { type: 'handEnded'; winner: PlayerId; points: number; reason: HandEndReason }
  | { type: 'scoreChanged'; scores: Record<PlayerId, number> }
  | { type: 'gameEnded'; winner: PlayerId };

/** A `GameEventData` stamped with a monotonic sequence number, for ordering and dedupe. */
export type GameEvent = GameEventData & { readonly seq: number };

export type GameEventType = GameEvent['type'];

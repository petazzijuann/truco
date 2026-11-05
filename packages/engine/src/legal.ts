import {
  type Action,
  type EnvidoCall,
  type FlorCall,
  type PlayerId,
  type TrucoCall,
  cardId,
} from '@truco/shared';
import { TRUCO_CALL_AT, TRUCO_LEVEL, envidoRaises, florRaises } from './betting.js';
import { hasFlor } from './envido.js';
import { currentTrickIndex, hasPlayedThisHand, type GameState } from './state.js';

/**
 * Truco-family calls this seat may make right now.
 *
 * Anyone may open with truco on their own turn. After that only the seat holding
 * "la palabra" -- whoever accepted the last call -- may raise, which is what stops a
 * player from calling twice in a row.
 */
export function trucoCallsFor(state: GameState, player: PlayerId): TrucoCall[] {
  if (state.truco.pending !== null) return [];
  if (state.truco.level >= 3) return [];
  if (state.truco.level > 0 && state.truco.wordHolder !== player) return [];
  const next = (state.truco.level + 1) as 1 | 2 | 3;
  return [TRUCO_CALL_AT[next]];
}

/**
 * Whether this seat may open the envido: first trick only, and only before they have
 * put a card down. A flor on the table annuls the envido for the hand.
 */
export function envidoAvailableFor(state: GameState, player: PlayerId): boolean {
  if (currentTrickIndex(state) !== 0) return false;
  if (state.envido.resolved !== null) return false;
  if (state.envido.chain.length > 0) return false;
  if (hasPlayedThisHand(state, player)) return false;
  // A flor on the table annuls the envido for the rest of the hand, and a seat
  // holding a flor announces that instead of counting an envido.
  if (state.flor.announced.length > 0) return false;
  if (state.config.flor && hasFlor(state.dealt[player])) return false;
  return true;
}

/**
 * Whether this seat may put its flor on the table: flor enabled, three of a suit in
 * hand, first trick, not yet played, and not already announced. Announcing is
 * optional -- a seat that stays quiet simply forfeits the points.
 */
export function florAvailableFor(state: GameState, player: PlayerId): boolean {
  if (!state.config.flor) return false;
  if (!hasFlor(state.dealt[player])) return false;
  if (state.flor.announced.includes(player)) return false;
  if (state.flor.resolved !== null) return false;
  if (currentTrickIndex(state) !== 0) return false;
  if (hasPlayedThisHand(state, player)) return false;
  return true;
}

export function florCallsFor(state: GameState, player: PlayerId): FlorCall[] {
  return florAvailableFor(state, player) ? ['flor'] : [];
}

export function envidoCallsFor(state: GameState, player: PlayerId): EnvidoCall[] {
  return envidoAvailableFor(state, player) ? envidoRaises([]) : [];
}

/**
 * The only moves available to `player`. Everything else the engine refuses, which is
 * what makes the server authoritative: it does not need to trust the client's UI.
 */
export function getLegalActions(state: GameState, player: PlayerId): Action[] {
  if (state.phase === 'gameOver') return [];
  // Either seat may ask for the next deal once the hand is scored.
  if (state.phase === 'handOver') return [{ type: 'nextHand' }];
  if (state.turn !== player) return [];

  switch (state.phase) {
    case 'playing': {
      const actions: Action[] = state.hands[player].map((card) => ({
        type: 'playCard',
        card: cardId(card),
      }));
      for (const call of florCallsFor(state, player)) actions.push({ type: call });
      for (const call of envidoCallsFor(state, player)) actions.push({ type: call });
      for (const call of trucoCallsFor(state, player)) actions.push({ type: call });
      actions.push({ type: 'irseAlMazo' });
      return actions;
    }

    case 'trucoResponse': {
      const actions: Action[] = [{ type: 'quiero' }, { type: 'noQuiero' }];
      // "El envido está primero": in the first trick, a seat that has not played yet
      // may answer a truco with an envido (or a flor), settled before the truco.
      for (const call of florCallsFor(state, player)) actions.push({ type: call });
      for (const call of envidoCallsFor(state, player)) actions.push({ type: call });
      // Answering with a raise ("quiero retruco") accepts the call and bumps it.
      const pending = state.truco.pending;
      if (pending !== null) {
        const pendingLevel = TRUCO_LEVEL[pending.call];
        if (pendingLevel < 3) {
          actions.push({ type: TRUCO_CALL_AT[(pendingLevel + 1) as 1 | 2 | 3] });
        }
      }
      return actions;
    }

    case 'envidoResponse': {
      const actions: Action[] = [{ type: 'quiero' }, { type: 'noQuiero' }];
      for (const call of envidoRaises(state.envido.chain)) actions.push({ type: call });
      // Answering an envido with a flor annuls the envido and puts the flor up instead.
      for (const call of florCallsFor(state, player)) actions.push({ type: call });
      return actions;
    }

    case 'envidoDeclaring': {
      const alreadySpoke = state.envido.declarations.length > 0;
      const actions: Action[] = [{ type: 'declarePoints' }];
      // The mano states a number; the other seat may concede with "son buenas".
      if (alreadySpoke) actions.push({ type: 'sonBuenas' });
      return actions;
    }

    case 'florResponse': {
      // Only a seat that also holds a flor ever gets here, so it may concede
      // ("con flor me achico"), accept the contest, or raise.
      const actions: Action[] = [{ type: 'quiero' }, { type: 'noQuiero' }];
      for (const call of florRaises(state.flor.chain)) actions.push({ type: call });
      return actions;
    }
  }
}

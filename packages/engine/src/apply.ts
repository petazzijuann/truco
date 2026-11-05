import {
  type Action,
  type EnvidoCall,
  type FlorCall,
  type GameEventData,
  type HandEndReason,
  type PlayerId,
  type Rng,
  type TrucoCall,
  cardFromId,
  cardId,
  opponentOf,
  sameAction,
} from '@truco/shared';
import {
  TRUCO_LEVEL,
  envidoAcceptedValue,
  envidoRejectedValue,
  florAcceptedValue,
  florRejectedValue,
  trucoRejectedValue,
  trucoValue,
} from './betting.js';
import { envidoBreakdown, envidoPoints, florPoints, florSuit, hasFlor } from './envido.js';
import { IllegalActionError } from './errors.js';
import { getLegalActions } from './legal.js';
import { completedOutcomes, currentTrickIndex, dealHand, emit, type GameState } from './state.js';
import { nextLeader, resolveHandWinner, trickOutcome } from './tricks.js';

/**
 * The single rule of the game engine: a pure, immutable transition.
 *
 * `rng` is only consumed by `nextHand`; everything else is deterministic. The input
 * state is never mutated -- every helper returns a fresh object.
 */
export function applyAction(
  state: GameState,
  player: PlayerId,
  action: Action,
  rng: Rng,
): GameState {
  const legal = getLegalActions(state, player);
  if (!legal.some((candidate) => sameAction(candidate, action))) {
    throw new IllegalActionError(player, action, `phase=${state.phase} turn=${state.turn}`);
  }

  const base: GameState = { ...state, emitted: [] };

  switch (action.type) {
    case 'playCard':
      return playCard(base, player, action.card);

    case 'truco':
    case 'retruco':
    case 'valeCuatro':
      return callTruco(base, player, action.type);

    case 'envido':
    case 'realEnvido':
    case 'faltaEnvido':
      return callEnvido(base, player, action.type);

    case 'quiero':
      return accept(base, player);

    case 'noQuiero':
      return refuse(base, player);

    case 'declarePoints':
      return declare(base, player, envidoPoints(base.dealt[player]));

    case 'sonBuenas':
      return declare(base, player, 'buenas');

    case 'irseAlMazo':
      return goToDeck(base, player);

    case 'nextHand':
      return dealHand(base, opponentOf(base.mano), rng);

    case 'flor':
    case 'contraflor':
    case 'contraflorAlResto':
      return callFlor(base, player, action.type);
  }
}

/* --------------------------------------------------------------- scoring ---- */

function addPoints(state: GameState, player: PlayerId, points: number): GameState {
  if (points <= 0) return state;
  const scores = { ...state.scores, [player]: state.scores[player] + points };
  let next = emit({ ...state, scores }, { type: 'scoreChanged', scores });
  if (scores[player] >= state.config.target) {
    next = revealCountedCards(next);
    next = emit(
      { ...next, phase: 'gameOver', winner: player, turn: player },
      {
        type: 'gameEnded',
        winner: player,
      },
    );
  }
  return next;
}

/**
 * At the end of the hand the player who won the envido shows the cards that back
 * their count -- and the winner of a flor shows the three of a suit. Cards that took
 * no part stay hidden.
 */
function revealCountedCards(state: GameState): GameState {
  let next = state;

  const flor = next.flor.resolved;
  if (flor !== null && next.revealed[flor.winner].length === 0) {
    const suit = florSuit(next.dealt[flor.winner]);
    /* v8 ignore next -- only a seat with a flor can win one */
    if (suit !== null) {
      const cards = next.dealt[flor.winner].filter((card) => card.suit === suit);
      next = emit(
        { ...next, revealed: { ...next.revealed, [flor.winner]: cards } },
        {
          type: 'cardsRevealed',
          player: flor.winner,
          cards: cards.map(cardId),
          reason: 'flor',
        },
      );
    }
  }

  const envido = next.envido.resolved;
  if (envido !== null && envido.wanted && next.revealed[envido.winner].length === 0) {
    const cards = envidoBreakdown(next.dealt[envido.winner]).cards;
    next = emit(
      { ...next, revealed: { ...next.revealed, [envido.winner]: cards } },
      {
        type: 'cardsRevealed',
        player: envido.winner,
        cards: cards.map(cardId),
        reason: 'envido',
      },
    );
  }

  return next;
}

function finishHand(
  state: GameState,
  winner: PlayerId,
  points: number,
  reason: HandEndReason,
): GameState {
  let next = revealCountedCards(state);
  next = emit(next, { type: 'handEnded', winner, points, reason });
  next = { ...next, lastHandResult: { winner, points, reason } };
  next = addPoints(next, winner, points);
  if (next.winner !== null) return next;
  return { ...next, phase: 'handOver', turn: opponentOf(next.mano), playTurn: next.mano };
}

/* ------------------------------------------------------------ card plays ---- */

function playCard(state: GameState, player: PlayerId, id: string): GameState {
  const card = cardFromId(id);
  /* v8 ignore next -- getLegalActions only offers cards actually held */
  if (card === undefined) throw new Error(`unknown card ${id}`);

  const hands = {
    ...state.hands,
    [player]: state.hands[player].filter((held) => cardId(held) !== id),
  };
  const trickIndex = currentTrickIndex(state);
  const tricks = state.tricks.map((trick, index) =>
    index === trickIndex ? { ...trick, plays: [...trick.plays, { player, card }] } : trick,
  );

  let next = emit(
    { ...state, hands, tricks },
    {
      type: 'cardPlayed',
      player,
      card: cardId(card),
      trick: trickIndex,
    },
  );

  const trick = next.tricks[trickIndex]!;
  if (trick.plays.length < 2) {
    return { ...next, turn: opponentOf(player), playTurn: opponentOf(player) };
  }

  const outcome = trickOutcome(trick.plays);
  next = {
    ...next,
    tricks: next.tricks.map((item, index) => (index === trickIndex ? { ...item, outcome } : item)),
  };
  next = emit(next, { type: 'trickResolved', trick: trickIndex, outcome });

  const handWinner = resolveHandWinner(completedOutcomes(next), next.mano);
  if (handWinner !== null) {
    return finishHand(next, handWinner, trucoValue(next.truco.level), 'tricks');
  }

  const leader = nextLeader(outcome, next.mano);
  return {
    ...next,
    tricks: [...next.tricks, { plays: [], outcome: null }],
    turn: leader,
    playTurn: leader,
  };
}

/* ----------------------------------------------------------------- truco ---- */

function callTruco(state: GameState, player: PlayerId, call: TrucoCall): GameState {
  const raising = state.phase === 'trucoResponse';
  // A raise ("quiero retruco") implicitly accepts the call it answers.
  const level = raising ? TRUCO_LEVEL[state.truco.pending!.call] : state.truco.level;
  const truco = {
    level,
    pending: { by: player, call },
    wordHolder: raising ? player : state.truco.wordHolder,
  };
  const next: GameState = {
    ...state,
    truco,
    phase: 'trucoResponse',
    turn: opponentOf(player),
    playTurn: raising ? state.playTurn : player,
  };
  return emit(next, { type: 'called', player, call });
}

/* ---------------------------------------------------------------- envido ---- */

function callEnvido(state: GameState, player: PlayerId, call: EnvidoCall): GameState {
  // "El envido está primero": park the truco, settle the envido, come back to it.
  const interrupting = state.phase === 'trucoResponse';
  const next: GameState = {
    ...state,
    trucoInterrupted: interrupting ? state.truco.pending : state.trucoInterrupted,
    truco: interrupting ? { ...state.truco, pending: null } : state.truco,
    envido: {
      ...state.envido,
      chain: [...state.envido.chain, call],
      pending: { by: player, call },
    },
    phase: 'envidoResponse',
    turn: opponentOf(player),
    playTurn: state.phase === 'playing' ? player : state.playTurn,
  };
  return emit(next, { type: 'called', player, call });
}

function accept(state: GameState, player: PlayerId): GameState {
  const next = emit(state, { type: 'responded', player, response: 'quiero' });

  if (next.phase === 'florResponse') return resolveFlorContest(next);

  if (next.phase === 'envidoResponse') {
    // Accepted: now the points get stated, mano first.
    return {
      ...next,
      envido: { ...next.envido, pending: null },
      phase: 'envidoDeclaring',
      turn: next.mano,
    };
  }

  const pending = next.truco.pending!;
  return {
    ...next,
    truco: { level: TRUCO_LEVEL[pending.call], pending: null, wordHolder: player },
    phase: 'playing',
    turn: next.playTurn,
  };
}

function refuse(state: GameState, player: PlayerId): GameState {
  const next = emit(state, { type: 'responded', player, response: 'noQuiero' });

  if (next.phase === 'florResponse') {
    // "Con flor me achico": the caller banks what the chain was worth before.
    const caller = next.flor.pending!.by;
    return settleFlor(next, caller, florRejectedValue(next.flor.chain), false);
  }

  if (next.phase === 'envidoResponse') {
    const caller = next.envido.pending!.by;
    const points = envidoRejectedValue(next.envido.chain);
    return settleEnvido(next, caller, points, false);
  }

  const pending = next.truco.pending!;
  const refused: GameState = { ...next, truco: { ...next.truco, pending: null } };
  return finishHand(refused, pending.by, trucoRejectedValue(pending.call), 'trucoRejected');
}

function declare(state: GameState, player: PlayerId, points: number | 'buenas'): GameState {
  const declarations = [...state.envido.declarations, { player, points }];
  const event: GameEventData =
    points === 'buenas'
      ? { type: 'sonBuenas', player }
      : { type: 'pointsDeclared', player, points };
  let next = emit({ ...state, envido: { ...state.envido, declarations } }, event);

  if (declarations.length < 2) {
    return { ...next, turn: opponentOf(player) };
  }

  const winner = envidoDeclarationWinner(next);
  const points2 = envidoAcceptedValue(next.envido.chain, next.scores, next.config, winner);
  next = settleEnvido(next, winner, points2, true);
  return next;
}

/** Highest count wins; a tie goes to the mano, who also wins if the other concedes. */
function envidoDeclarationWinner(state: GameState): PlayerId {
  const mano = state.mano;
  const manoDecl = state.envido.declarations.find((entry) => entry.player === mano);
  const otherDecl = state.envido.declarations.find((entry) => entry.player !== mano);
  /* v8 ignore next -- both seats have spoken by the time this runs */
  if (manoDecl === undefined || otherDecl === undefined) throw new Error('missing declaration');
  if (otherDecl.points === 'buenas') return mano;
  /* v8 ignore next -- the mano is required to state a number */
  if (manoDecl.points === 'buenas') return otherDecl.player;
  return otherDecl.points > manoDecl.points ? otherDecl.player : mano;
}

function settleEnvido(
  state: GameState,
  winner: PlayerId,
  points: number,
  wanted: boolean,
): GameState {
  let next: GameState = {
    ...state,
    envido: { ...state.envido, pending: null, resolved: { winner, points, wanted } },
  };
  next = emit(next, { type: 'envidoResolved', winner, points, wanted });
  next = addPoints(next, winner, points);

  return resumeAfterSideBet(next, winner, points);
}

/**
 * Back to the cards once a side bet (envido or flor) is settled. If a truco was
 * parked by "el envido está primero" it goes back on the table; and a side bet can
 * take the game outright, which ends the hand where it stands.
 */
function resumeAfterSideBet(state: GameState, winner: PlayerId, points: number): GameState {
  if (state.winner !== null) {
    return { ...state, lastHandResult: { winner, points, reason: 'target' } };
  }

  if (state.trucoInterrupted !== null) {
    const parked = state.trucoInterrupted;
    return {
      ...state,
      truco: { ...state.truco, pending: parked },
      trucoInterrupted: null,
      phase: 'trucoResponse',
      turn: opponentOf(parked.by),
    };
  }

  return { ...state, phase: 'playing', turn: state.playTurn };
}

/* ------------------------------------------------------------------ flor ---- */

/**
 * Put a flor on the table.
 *
 * A flor annuls the envido for the rest of the hand: any envido awaiting an answer
 * is dropped without paying. If the other seat has no flor the points are collected
 * on the spot; otherwise it becomes a contest they must answer.
 */
function callFlor(state: GameState, player: PlayerId, call: FlorCall): GameState {
  const interruptingTruco = state.phase === 'trucoResponse';
  const announced = state.flor.announced.includes(player)
    ? state.flor.announced
    : [...state.flor.announced, player];

  let next: GameState = {
    ...state,
    trucoInterrupted: interruptingTruco ? state.truco.pending : state.trucoInterrupted,
    truco: interruptingTruco ? { ...state.truco, pending: null } : state.truco,
    // The envido is annulled: the call is forgotten and nothing is paid for it.
    envido: { ...state.envido, pending: null },
    flor: { ...state.flor, chain: [...state.flor.chain, call], announced },
    playTurn: state.phase === 'playing' ? player : state.playTurn,
  };
  next = emit(next, { type: 'called', player, call });

  const responder = opponentOf(player);
  if (!hasFlor(next.dealt[responder])) {
    // Uncontested: nobody to answer, so the flor simply pays its base value.
    return settleFlor(next, player, florRejectedValue(next.flor.chain), false);
  }

  return {
    ...next,
    flor: { ...next.flor, pending: { by: player, call }, announced: [...announced, responder] },
    phase: 'florResponse',
    turn: responder,
  };
}

function settleFlor(
  state: GameState,
  winner: PlayerId,
  points: number,
  wanted: boolean,
): GameState {
  let next: GameState = {
    ...state,
    flor: { ...state.flor, pending: null, resolved: { winner, points, wanted } },
  };
  next = emit(next, { type: 'florResolved', winner, points, wanted });
  next = addPoints(next, winner, points);
  return resumeAfterSideBet(next, winner, points);
}

/** Both seats hold a flor, so the higher count takes it; a tie goes to the mano. */
function resolveFlorContest(state: GameState): GameState {
  const mano = state.mano;
  const other = opponentOf(mano);
  const manoPoints = florPoints(state.dealt[mano]);
  const otherPoints = florPoints(state.dealt[other]);

  let next = emit(state, { type: 'pointsDeclared', player: mano, points: manoPoints });
  next = emit(next, { type: 'pointsDeclared', player: other, points: otherPoints });

  const winner = otherPoints > manoPoints ? other : mano;
  const points = florAcceptedValue(next.flor.chain, next.scores, next.config, winner);
  return settleFlor(next, winner, points, true);
}

/* ------------------------------------------------------------------ mazo ---- */

function goToDeck(state: GameState, player: PlayerId): GameState {
  const next = emit(state, { type: 'wentToDeck', player });
  const penalty =
    state.config.mazoPrimeraPenalty &&
    currentTrickIndex(state) === 0 &&
    state.envido.resolved === null
      ? 1
      : 0;
  const points = trucoValue(state.truco.level) + penalty;
  return finishHand(next, opponentOf(player), points, 'mazo');
}

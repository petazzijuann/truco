import {
  type Card,
  type CardId,
  type PlayerId,
  type PlayerView,
  type TrickView,
  cardId,
  opponentOf,
} from '@truco/shared';
import { trucoValue } from './betting.js';
import { envidoPoints, hasFlor } from './envido.js';
import { handStrength } from './hierarchy.js';
import { envidoAvailableFor, getLegalActions } from './legal.js';
import { currentTrickIndex, type GameState } from './state.js';

const copy = (cards: readonly Card[]): Card[] => cards.map((card) => ({ ...card }));

/**
 * The one and only bridge out of the full game state.
 *
 * Everything here is either the viewer's own information or already public: cards
 * played face-up, calls and responses, declared envido counts, and the cards the
 * envido winner showed at the end of the hand. The opponent's unplayed cards are
 * never read, so they cannot leak through a payload, a log line, or the DOM.
 *
 * The AI consumes exactly this -- it is given no other input, by signature.
 */
export function getPlayerView(state: GameState, me: PlayerId): PlayerView {
  const opponent = opponentOf(me);

  const tricks: TrickView[] = state.tricks.map((trick) => ({
    plays: trick.plays.map((play) => ({ player: play.player, card: { ...play.card } })),
    outcome: trick.outcome,
  }));

  // Opponent cards that became public: played to the table, or shown for the envido
  // or flor. A card can be both -- played face-up and part of the count it showed --
  // so the two sources are merged by identity rather than concatenated.
  const knownById = new Map<CardId, Card>();
  for (const trick of state.tricks) {
    for (const play of trick.plays) {
      if (play.player === opponent) knownById.set(cardId(play.card), { ...play.card });
    }
  }
  for (const card of state.revealed[opponent]) knownById.set(cardId(card), { ...card });
  const knownOpponentCards = [...knownById.values()];

  return {
    me,
    opponent,
    config: { ...state.config },

    scores: { ...state.scores },
    handNumber: state.handNumber,
    mano: state.mano,
    turn: state.turn,
    playTurn: state.playTurn,
    phase: state.phase,

    myHand: copy(state.hands[me]),
    myDealtHand: copy(state.dealt[me]),
    myEnvidoPoints: envidoPoints(state.dealt[me]),
    myHandStrength: handStrength(state.hands[me]),
    iHaveFlor: state.config.flor && hasFlor(state.dealt[me]),

    opponentCardCount: state.hands[opponent].length,
    knownOpponentCards,

    tricks,
    currentTrick:
      state.phase === 'handOver' || state.phase === 'gameOver' ? 3 : currentTrickIndex(state),

    truco: {
      level: state.truco.level,
      value: trucoValue(state.truco.level),
      pending: state.truco.pending === null ? null : { ...state.truco.pending },
      wordHolder: state.truco.wordHolder,
      parked: state.trucoInterrupted === null ? null : { ...state.trucoInterrupted },
    },
    envido: {
      chain: [...state.envido.chain],
      pending: state.envido.pending === null ? null : { ...state.envido.pending },
      declarations: state.envido.declarations.map((entry) => ({ ...entry })),
      resolved: state.envido.resolved === null ? null : { ...state.envido.resolved },
      stillAvailable: envidoAvailableFor(state, me),
    },
    flor: {
      chain: [...state.flor.chain],
      pending: state.flor.pending === null ? null : { ...state.flor.pending },
      announced: [...state.flor.announced],
      resolved: state.flor.resolved === null ? null : { ...state.flor.resolved },
    },

    legalActions: getLegalActions(state, me),
    log: state.log.map((event) => ({ ...event })),

    lastHandResult: state.lastHandResult === null ? null : { ...state.lastHandResult },
    winner: state.winner,
  };
}

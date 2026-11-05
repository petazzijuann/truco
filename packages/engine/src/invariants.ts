import { DECK_SIZE, PLAYER_IDS, cardId, type PlayerId } from '@truco/shared';
import { CARDS_PER_HAND } from './deck.js';
import type { GameState } from './state.js';

/**
 * Structural truths that must hold after every single transition. The property-based
 * tests assert these over thousands of randomly played hands; a violation means the
 * state machine corrupted the game, not merely that it made a bad ruling.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];

  const accounted = [
    ...state.dealt.human.map(cardId),
    ...state.dealt.ai.map(cardId),
    ...state.undealt.map(cardId),
  ];
  if (accounted.length !== DECK_SIZE) {
    problems.push(`${accounted.length} cards accounted for, expected ${DECK_SIZE}`);
  }
  if (new Set(accounted).size !== accounted.length) {
    problems.push('a card appears twice in the deck');
  }

  for (const player of PLAYER_IDS) {
    if (state.dealt[player].length !== CARDS_PER_HAND) {
      problems.push(`${player} was dealt ${state.dealt[player].length} cards`);
    }
    // Every unplayed card must be one of the three that were dealt.
    const dealtIds = new Set(state.dealt[player].map(cardId));
    for (const held of state.hands[player]) {
      if (!dealtIds.has(cardId(held))) problems.push(`${player} holds a card it was not dealt`);
    }
    if (state.scores[player] < 0) problems.push(`${player} has a negative score`);
  }

  // Nobody may play a card from the other seat's hand.
  for (const trick of state.tricks) {
    for (const play of trick.plays) {
      const owner: PlayerId = play.player;
      if (!state.dealt[owner].some((card) => cardId(card) === cardId(play.card))) {
        problems.push(`${owner} played ${cardId(play.card)}, which was never theirs`);
      }
    }
  }

  // Played cards must have left the hand.
  for (const player of PLAYER_IDS) {
    const played = state.tricks.flatMap((trick) =>
      trick.plays.filter((play) => play.player === player),
    ).length;
    const expected = CARDS_PER_HAND - played;
    if (state.hands[player].length !== expected) {
      problems.push(`${player} holds ${state.hands[player].length} cards, expected ${expected}`);
    }
  }

  if (state.tricks.length > 3) problems.push(`${state.tricks.length} tricks in one hand`);

  if (state.winner !== null && state.scores[state.winner] < state.config.target) {
    problems.push('declared a winner below the target score');
  }
  if (state.phase === 'gameOver' && state.winner === null) {
    problems.push('game over with no winner');
  }

  // At most one call of each family may be awaiting an answer.
  if (state.truco.pending !== null && state.envido.pending !== null) {
    problems.push('two calls pending at once');
  }

  return problems;
}

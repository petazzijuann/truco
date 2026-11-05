import { SUITS, type Card, type Suit } from '@truco/shared';

/** Figures (10, 11, 12) count as zero towards the envido. */
export const envidoCardValue = (card: Card): number => (card.rank >= 10 ? 0 : card.rank);

export const MAX_ENVIDO = 33;

/**
 * Envido count: with two or three cards of one suit, the two highest of that suit
 * plus 20; otherwise just the highest single card. The ceiling is 33 (7 + 6 + 20).
 */
export function envidoPoints(cards: readonly Card[]): number {
  return envidoBreakdown(cards).points;
}

/**
 * The count together with the cards that justify it -- these are the ones a player
 * shows at the end of the hand after winning the envido. Cards that did not take
 * part are never revealed.
 */
export function envidoBreakdown(cards: readonly Card[]): { points: number; cards: Card[] } {
  let best: { points: number; cards: Card[] } = { points: -1, cards: [] };

  for (const suit of SUITS) {
    const ofSuit = cards.filter((card) => card.suit === suit);
    if (ofSuit.length < 2) continue;
    const [high, second] = ofSuit.sort((a, b) => envidoCardValue(b) - envidoCardValue(a));
    const points = 20 + envidoCardValue(high!) + envidoCardValue(second!);
    if (points > best.points) best = { points, cards: [high!, second!] };
  }

  if (best.points >= 0) return best;

  // No two cards share a suit: the highest single card stands alone.
  let highest: Card | undefined;
  for (const card of cards) {
    if (highest === undefined || envidoCardValue(card) > envidoCardValue(highest)) highest = card;
  }
  if (highest === undefined) return { points: 0, cards: [] };
  return { points: envidoCardValue(highest), cards: [highest] };
}

/** Three cards of the same suit. Only relevant when flor is enabled. */
export function hasFlor(cards: readonly Card[]): boolean {
  return florSuit(cards) !== null;
}

export function florSuit(cards: readonly Card[]): Suit | null {
  if (cards.length < 3) return null;
  for (const suit of SUITS) {
    if (cards.filter((card) => card.suit === suit).length >= 3) return suit;
  }
  return null;
}

/**
 * Flor count: 20 plus the three cards of the suit. Ties are broken by this number,
 * so it matters even though the call itself is worth a fixed 3.
 */
export function florPoints(cards: readonly Card[]): number {
  const suit = florSuit(cards);
  if (suit === null) return 0;
  const ofSuit = cards.filter((card) => card.suit === suit).slice(0, 3);
  return 20 + ofSuit.reduce((sum, card) => sum + envidoCardValue(card), 0);
}

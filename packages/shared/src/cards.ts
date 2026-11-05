/** Spanish deck: 40 cards, no 8s and no 9s. */

export const SUITS = ['espada', 'basto', 'oro', 'copa'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const;
export type Rank = (typeof RANKS)[number];

export type Card = { readonly rank: Rank; readonly suit: Suit };

/** Stable textual identity of a card, e.g. `7-espada`. Used as a map key and in the wire format. */
export type CardId = `${Rank}-${Suit}`;

export const cardId = (card: Card): CardId => `${card.rank}-${card.suit}`;

export const sameCard = (a: Card, b: Card): boolean => a.rank === b.rank && a.suit === b.suit;

const CARD_BY_ID = new Map<CardId, Card>();
for (const suit of SUITS) {
  for (const rank of RANKS) {
    CARD_BY_ID.set(`${rank}-${suit}`, { rank, suit });
  }
}

/** All 40 cards, in a fixed canonical order (suit major, rank minor). */
export const FULL_DECK: readonly Card[] = Object.freeze([...CARD_BY_ID.values()]);

export const DECK_SIZE = 40;

export function cardFromId(id: string): Card | undefined {
  return CARD_BY_ID.get(id as CardId);
}

export function isCardId(id: string): id is CardId {
  return CARD_BY_ID.has(id as CardId);
}

/** Spanish names used for `aria-label`s and the AI's speech bubbles. */
export const SUIT_LABEL: Readonly<Record<Suit, string>> = Object.freeze({
  espada: 'espada',
  basto: 'basto',
  oro: 'oro',
  copa: 'copa',
});

export const cardLabel = (card: Card): string => `${card.rank} de ${SUIT_LABEL[card.suit]}`;

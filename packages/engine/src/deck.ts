import { DECK_SIZE, FULL_DECK, shuffle, type Card, type Rng } from '@truco/shared';

export const CARDS_PER_HAND = 3;

/** A fresh 40-card deck, shuffled with Fisher-Yates through the injected `Rng`. */
export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(FULL_DECK, rng);
}

export type Deal = { readonly first: Card[]; readonly second: Card[]; readonly rest: Card[] };

/**
 * Three cards each, dealt off the top. `rest` is the undealt remainder -- the engine
 * keeps it so the invariant "40 cards exist at all times" stays checkable, and so the
 * AI knows exactly which cards are unaccounted for.
 */
export function deal(rng: Rng): Deal {
  const deck = shuffledDeck(rng);
  /* v8 ignore next -- shuffle preserves length; guards against a broken Rng */
  if (deck.length !== DECK_SIZE) throw new Error(`deck has ${deck.length} cards`);
  return {
    first: deck.slice(0, CARDS_PER_HAND),
    second: deck.slice(CARDS_PER_HAND, CARDS_PER_HAND * 2),
    rest: deck.slice(CARDS_PER_HAND * 2),
  };
}

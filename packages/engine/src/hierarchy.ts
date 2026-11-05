import { DECK_SIZE, RANKS, SUITS, cardId, type Card, type CardId, type Rank } from '@truco/shared';

/**
 * The truco pecking order, strongest tier first. Cards inside a tier are equal and
 * tie ("parda"). Unlike the envido count, this ordering has nothing to do with the
 * face value of the card.
 */
const TIERS: readonly (readonly Card[])[] = [
  [{ rank: 1, suit: 'espada' }], // ancho de espada
  [{ rank: 1, suit: 'basto' }], // ancho de basto
  [{ rank: 7, suit: 'espada' }],
  [{ rank: 7, suit: 'oro' }],
  allOf(3),
  allOf(2),
  [
    { rank: 1, suit: 'copa' },
    { rank: 1, suit: 'oro' },
  ], // anchos falsos
  allOf(12),
  allOf(11),
  allOf(10),
  [
    { rank: 7, suit: 'copa' },
    { rank: 7, suit: 'basto' },
  ],
  allOf(6),
  allOf(5),
  allOf(4),
];

function allOf(rank: Rank): Card[] {
  return SUITS.map((suit) => ({ rank, suit }));
}

/** Higher is stronger. Equal values mean the cards tie. */
export const MAX_STRENGTH = TIERS.length;

const STRENGTH = new Map<CardId, number>();
TIERS.forEach((tier, index) => {
  const strength = TIERS.length - index;
  for (const card of tier) STRENGTH.set(cardId(card), strength);
});

/* v8 ignore next 3 -- module-load sanity check */
if (STRENGTH.size !== DECK_SIZE) {
  throw new Error(`hierarchy covers ${STRENGTH.size} cards, expected ${DECK_SIZE}`);
}

export function strengthOf(card: Card): number {
  const strength = STRENGTH.get(cardId(card));
  if (strength === undefined) throw new Error(`card outside the deck: ${cardId(card)}`);
  return strength;
}

/** Negative if `a` is weaker, positive if stronger, zero on a tie. */
export const compareStrength = (a: Card, b: Card): number => strengthOf(a) - strengthOf(b);

export const beats = (a: Card, b: Card): boolean => strengthOf(a) > strengthOf(b);

export const ties = (a: Card, b: Card): boolean => strengthOf(a) === strengthOf(b);

/** Strongest first; ties keep their relative order. */
export const byStrengthDesc = (cards: readonly Card[]): Card[] =>
  [...cards].sort((a, b) => compareStrength(b, a));

/** The full ordering, strongest first, as tiers. Used by the Rules screen. */
export const hierarchyTiers = (): readonly (readonly Card[])[] => TIERS;

export const allCardsRanked = (): Card[] =>
  SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))).sort((a, b) =>
    compareStrength(b, a),
  );

/**
 * Relative strength of a whole hand in `[0, 1]`. The top card carries most of the
 * weight, which is roughly how players actually read a hand. Used by the optional
 * help display (for your own cards only) and as a cheap AI heuristic.
 */
const HAND_WEIGHTS = [0.5, 0.3, 0.2] as const;

export function handStrength(cards: readonly Card[]): number {
  if (cards.length === 0) return 0;
  const sorted = byStrengthDesc(cards).slice(0, HAND_WEIGHTS.length);
  let weighted = 0;
  let weightUsed = 0;
  sorted.forEach((card, index) => {
    const weight = HAND_WEIGHTS[index]!;
    weighted += (strengthOf(card) / MAX_STRENGTH) * weight;
    weightUsed += weight;
  });
  return weighted / weightUsed;
}

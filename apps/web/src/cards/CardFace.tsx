import type { Card, Rank } from '@truco/shared';
import { cardId } from '@truco/shared';
import { SUIT_COLOR, SuitGlyph } from './suits.js';
import { cardAria } from '../text.js';

export const CARD_W = 100;
export const CARD_H = 152;

/** Pip layouts for 1..7, in card coordinates. Figures are drawn differently. */
const PIP_LAYOUT: Readonly<Record<number, readonly [number, number][]>> = {
  1: [[50, 76]],
  2: [
    [50, 48],
    [50, 104],
  ],
  3: [
    [50, 40],
    [50, 76],
    [50, 112],
  ],
  4: [
    [33, 48],
    [67, 48],
    [33, 104],
    [67, 104],
  ],
  5: [
    [33, 48],
    [67, 48],
    [50, 76],
    [33, 104],
    [67, 104],
  ],
  6: [
    [33, 44],
    [67, 44],
    [33, 76],
    [67, 76],
    [33, 108],
    [67, 108],
  ],
  7: [
    [33, 42],
    [67, 42],
    [33, 72],
    [67, 72],
    [50, 57],
    [33, 104],
    [67, 104],
  ],
};

const isFigure = (rank: Rank): rank is 10 | 11 | 12 => rank >= 10;

/** A small decorative silhouette for the three court cards. */
function Figure({ rank }: { rank: 10 | 11 | 12 }) {
  if (rank === 12) {
    // A crown.
    return (
      <g fill="currentColor">
        <path d="M26 46 L34 62 L50 44 L66 62 L74 46 L74 72 L26 72 Z" />
        <rect x="26" y="75" width="48" height="7" rx="3" />
        <circle cx="26" cy="42" r="4" />
        <circle cx="50" cy="40" r="4" />
        <circle cx="74" cy="42" r="4" />
      </g>
    );
  }
  if (rank === 11) {
    // A horse's head.
    return (
      <g fill="currentColor">
        <path d="M34 82 C30 62 36 46 50 40 C56 37 60 40 58 46 L54 56 C66 58 72 68 72 82 Z" />
        <path d="M48 40 L44 28 L54 34 Z" />
        <circle cx="52" cy="54" r="2.6" fill="var(--card-paper)" />
      </g>
    );
  }
  // A page: head and shoulders.
  return (
    <g fill="currentColor">
      <circle cx="50" cy="52" r="13" />
      <path d="M28 84 C28 68 38 62 50 62 C62 62 72 68 72 84 Z" />
    </g>
  );
}

export type CardFaceProps = {
  card: Card;
  /** Dim the card, e.g. an illegal play. */
  muted?: boolean;
  /** Draw a highlight ring, e.g. the winner of a trick. */
  glow?: boolean;
};

/**
 * One card, drawn entirely here.
 *
 * The design is deliberately my own: cream stock, a thin suit-coloured frame, large
 * corner numerals for readability on a phone, and the suit glyph repeated as pips.
 * Nothing is traced from a published deck.
 */
export function CardFace({ card, muted = false, glow = false }: CardFaceProps) {
  const colour = SUIT_COLOR[card.suit];
  const pips = PIP_LAYOUT[card.rank];
  const figure = isFigure(card.rank);
  const titleId = `card-${cardId(card)}`;

  return (
    <svg
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className={`card-face${muted ? ' is-muted' : ''}${glow ? ' is-glowing' : ''}`}
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>{cardAria(card)}</title>

      <rect
        x="1.5"
        y="1.5"
        width={CARD_W - 3}
        height={CARD_H - 3}
        rx="9"
        fill="var(--card-paper)"
      />
      <rect
        x="1.5"
        y="1.5"
        width={CARD_W - 3}
        height={CARD_H - 3}
        rx="9"
        fill="none"
        stroke={colour}
        strokeWidth="2.5"
      />
      <rect
        x="7"
        y="7"
        width={CARD_W - 14}
        height={CARD_H - 14}
        rx="6"
        fill="none"
        stroke={colour}
        strokeWidth="0.9"
        opacity="0.45"
      />

      {/* Corner numerals, top-left and bottom-right (rotated), as on a real deck. */}
      <text x="14" y="28" className="card-rank" fill={colour}>
        {card.rank}
      </text>
      <text
        x={CARD_W - 14}
        y={CARD_H - 28}
        className="card-rank"
        fill={colour}
        transform={`rotate(180 ${CARD_W - 14} ${CARD_H - 28})`}
      >
        {card.rank}
      </text>

      {/* Small suit mark beside each numeral. */}
      <g transform="translate(13 30) scale(0.17)">
        <SuitGlyph suit={card.suit} />
      </g>
      <g transform={`translate(${CARD_W - 30} ${CARD_H - 47}) scale(0.17)`}>
        <SuitGlyph suit={card.suit} />
      </g>

      {figure ? (
        <g>
          {/* The court figure sits in the middle band, clear of both numerals. */}
          <g transform="translate(22 34) scale(0.56)" style={{ color: colour }}>
            <Figure rank={card.rank} />
          </g>
          <g transform={`translate(${CARD_W / 2 - 13} ${CARD_H - 44}) scale(0.26)`}>
            <SuitGlyph suit={card.suit} />
          </g>
        </g>
      ) : (
        pips?.map(([x, y], index) => {
          // A lone pip is the whole design of the card, so it is drawn much larger.
          const scale = card.rank === 1 ? 0.46 : 0.26;
          const half = 50 * scale;
          return (
            <g key={index} transform={`translate(${x - half} ${y - half}) scale(${scale})`}>
              <SuitGlyph suit={card.suit} />
            </g>
          );
        })
      )}
    </svg>
  );
}

/** The back of a card: my own woven-lattice pattern over the table's own palette. */
export function CardBack() {
  return (
    <svg
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className="card-face card-back"
      role="img"
      aria-label="Carta boca abajo"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="truco-back" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="var(--card-back-base)" />
          <path
            d="M0 12 L12 0 M-3 3 L3 -3 M9 15 L15 9"
            stroke="var(--card-back-line)"
            strokeWidth="1.6"
          />
          <circle cx="6" cy="6" r="1.4" fill="var(--card-back-dot)" />
        </pattern>
      </defs>
      <rect
        x="1.5"
        y="1.5"
        width={CARD_W - 3}
        height={CARD_H - 3}
        rx="9"
        fill="var(--card-back-base)"
      />
      <rect x="7" y="7" width={CARD_W - 14} height={CARD_H - 14} rx="5" fill="url(#truco-back)" />
      <rect
        x="1.5"
        y="1.5"
        width={CARD_W - 3}
        height={CARD_H - 3}
        rx="9"
        fill="none"
        stroke="var(--card-back-edge)"
        strokeWidth="2.5"
      />
      <ellipse
        cx={CARD_W / 2}
        cy={CARD_H / 2}
        rx="24"
        ry="30"
        fill="var(--card-back-base)"
        opacity="0.85"
      />
      <ellipse
        cx={CARD_W / 2}
        cy={CARD_H / 2}
        rx="24"
        ry="30"
        fill="none"
        stroke="var(--card-back-line)"
        strokeWidth="1.6"
      />
      <text x={CARD_W / 2} y={CARD_H / 2 + 6} className="card-back-mark">
        T
      </text>
    </svg>
  );
}

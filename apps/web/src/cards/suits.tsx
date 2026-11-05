import type { Suit } from '@truco/shared';

/**
 * The four Spanish suits, drawn from scratch.
 *
 * Each glyph is authored in a 0..100 box so it can be dropped anywhere on a card and
 * scaled freely. The shapes are my own reading of the traditional iconography --
 * espada a straight sword, basto a knotted club, oro a struck coin, copa a footed
 * goblet -- rather than a trace of any published deck.
 */
export type SuitGlyphProps = { suit: Suit; className?: string };

export const SUIT_COLOR: Readonly<Record<Suit, string>> = {
  espada: 'var(--suit-espada)',
  basto: 'var(--suit-basto)',
  oro: 'var(--suit-oro)',
  copa: 'var(--suit-copa)',
};

function Espada() {
  return (
    <g>
      {/* Blade, guard and grip are kept deliberately heavy: these glyphs are also
          drawn as pips at a quarter size, where a thin shape disappears. */}
      <path d="M50 4 L60 20 L60 59 L50 72 L40 59 L40 20 Z" fill="currentColor" />
      <path d="M50 12 L50 66" stroke="rgba(255,255,255,0.45)" strokeWidth="3" />
      <rect x="17" y="59" width="66" height="10" rx="5" fill="currentColor" />
      <rect x="43" y="68" width="14" height="18" rx="4" fill="currentColor" />
      <circle cx="50" cy="90" r="8" fill="currentColor" />
    </g>
  );
}

function Basto() {
  return (
    <g>
      {/* A heavy tapered club, so it still reads when drawn as a small pip. */}
      <path
        d="M40 95 C35 70 38 42 45 14 C46 5 54 5 55 14 C62 42 65 70 60 95 Z"
        fill="currentColor"
      />
      {/* knots */}
      <path d="M42 38 L26 29" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
      <path d="M59 58 L75 50" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
      <path d="M42 72 L28 67" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      <path
        d="M48 18 C50 44 50 70 48 92"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="2.5"
        fill="none"
      />
    </g>
  );
}

function Oro() {
  return (
    <g>
      <circle cx="50" cy="50" r="40" fill="currentColor" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="26" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
      {/* eight-pointed star struck in the middle */}
      <path
        d="M50 26 L56 44 L74 50 L56 56 L50 74 L44 56 L26 50 L44 44 Z"
        fill="rgba(255,255,255,0.55)"
      />
    </g>
  );
}

function Copa() {
  return (
    <g>
      {/* bowl */}
      <path d="M22 20 H78 C78 50 65 64 50 64 C35 64 22 50 22 20 Z" fill="currentColor" />
      <path
        d="M30 25 H70 C69 44 61 56 50 56"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="3"
      />
      {/* rim */}
      <rect x="17" y="13" width="66" height="9" rx="4.5" fill="currentColor" />
      {/* stem and foot */}
      <rect x="44" y="64" width="12" height="16" rx="2" fill="currentColor" />
      <path d="M30 88 C30 80 40 78 50 78 C60 78 70 80 70 88 Z" fill="currentColor" />
    </g>
  );
}

const GLYPHS: Readonly<Record<Suit, () => JSX.Element>> = {
  espada: Espada,
  basto: Basto,
  oro: Oro,
  copa: Copa,
};

/** One suit glyph, filling the viewBox it is placed in. */
export function SuitGlyph({ suit, className }: SuitGlyphProps) {
  const Glyph = GLYPHS[suit];
  return (
    <g className={className} style={{ color: SUIT_COLOR[suit] }}>
      <Glyph />
    </g>
  );
}

/** A suit glyph as a standalone icon, for the rules page and the scoreboard. */
export function SuitIcon({ suit, size = 24 }: { suit: Suit; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={suit}
      style={{ display: 'block' }}
    >
      <SuitGlyph suit={suit} />
    </svg>
  );
}

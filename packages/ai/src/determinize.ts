import {
  FULL_DECK,
  cardId,
  opponentOf,
  shuffle,
  type Card,
  type PlayerId,
  type PlayerView,
  type Rng,
} from '@truco/shared';
import { envidoPoints, handStrength, hasFlor, type GameState, type Trick } from '@truco/engine';

/**
 * What the public record says about the opponent's hand. Everything here comes off
 * the event log -- cards they played, counts they stated out loud, calls they made --
 * so nothing in this type is privileged information.
 */
export type OpponentReads = {
  /** An exact envido count they stated. */
  declaredEnvido: number | null;
  /** They said "son buenas", conceding to this count. */
  concededTo: number | null;
  announcedFlor: boolean;
  calledTruco: boolean;
  refusedTruco: boolean;
  calledEnvido: boolean;
  /** Flor is on, they have had their chance to announce, and they stayed quiet. */
  florWindowClosed: boolean;
};

const TRUCO_CALLS = new Set(['truco', 'retruco', 'valeCuatro']);
const ENVIDO_CALLS = new Set(['envido', 'realEnvido', 'faltaEnvido']);

export function readOpponent(view: PlayerView): OpponentReads {
  const opponent = view.opponent;
  const reads: OpponentReads = {
    declaredEnvido: null,
    concededTo: null,
    announcedFlor: false,
    calledTruco: false,
    refusedTruco: false,
    calledEnvido: false,
    florWindowClosed: false,
  };

  let lastDeclared: number | null = null;
  for (const event of view.log) {
    switch (event.type) {
      case 'pointsDeclared':
        if (event.player === opponent) reads.declaredEnvido = event.points;
        else lastDeclared = event.points;
        break;
      case 'sonBuenas':
        // They conceded to whatever count was on the table.
        if (event.player === opponent) reads.concededTo = lastDeclared;
        break;
      case 'called':
        if (event.player !== opponent) break;
        if (TRUCO_CALLS.has(event.call)) reads.calledTruco = true;
        else if (ENVIDO_CALLS.has(event.call)) reads.calledEnvido = true;
        else reads.announcedFlor = true;
        break;
      case 'responded':
        if (event.player === opponent && event.response === 'noQuiero' && view.truco.level === 0) {
          reads.refusedTruco = true;
        }
        break;
      default:
        break;
    }
  }

  // Flor must be announced in the first trick before playing. Once the opponent has
  // put a card down without announcing, a flor is unlikely (though humans do forget).
  const opponentPlayed = view.tricks.some((trick) =>
    trick.plays.some((play) => play.player === opponent),
  );
  reads.florWindowClosed = view.config.flor && !reads.announcedFlor && opponentPlayed;

  return reads;
}

/** Opponent cards already made public, split into the ones played and the ones shown. */
function opponentPublicCards(view: PlayerView): { played: Card[]; shown: Card[] } {
  const played: Card[] = [];
  for (const trick of view.tricks) {
    for (const play of trick.plays) {
      if (play.player === view.opponent) played.push(play.card);
    }
  }
  const playedIds = new Set(played.map(cardId));
  const shown = view.knownOpponentCards.filter((card) => !playedIds.has(cardId(card)));
  return { played, shown };
}

/** Cards the viewer cannot account for, i.e. the pool the opponent's hand is drawn from. */
export function unseenPool(view: PlayerView): Card[] {
  const accounted = new Set<string>([
    ...view.myDealtHand.map(cardId),
    ...view.knownOpponentCards.map(cardId),
  ]);
  return FULL_DECK.filter((card) => !accounted.has(cardId(card)));
}

/** Hard constraints: a sampled hand that contradicts the public record is impossible. */
function isPossible(dealt: readonly Card[], reads: OpponentReads): boolean {
  if (reads.declaredEnvido !== null && envidoPoints(dealt) !== reads.declaredEnvido) return false;
  if (reads.concededTo !== null && envidoPoints(dealt) > reads.concededTo) return false;
  if (reads.announcedFlor && !hasFlor(dealt)) return false;
  return true;
}

/**
 * Soft read, in `(0, 1]`. Calls shade the distribution towards hands that justify
 * them, but never to the point of assuming honesty -- a bluff stays possible, which
 * is what stops the AI from being farmed by a liar.
 */
function plausibility(dealt: readonly Card[], reads: OpponentReads): number {
  let weight = 1;
  const strength = handStrength(dealt);

  if (reads.calledTruco) weight *= 0.3 + 0.7 * strength;
  if (reads.refusedTruco) weight *= 1 - 0.6 * strength;
  if (reads.calledEnvido && reads.declaredEnvido === null) {
    weight *= 0.3 + 0.7 * Math.min(1, envidoPoints(dealt) / 33);
  }
  // A flor that was never announced, after the window closed.
  if (reads.florWindowClosed && hasFlor(dealt)) weight *= 0.15;

  return Math.max(0.02, Math.min(1, weight));
}

const MAX_ATTEMPTS = 60;

/**
 * Sample one hand the opponent could plausibly be holding.
 *
 * Draws from the unseen pool, rejects anything the public record rules out, and then
 * accepts with a probability shaded by the opponent's calls. Returns the opponent's
 * three dealt cards -- their public ones included -- so the caller can rebuild a
 * whole hypothetical hand.
 */
export function sampleOpponentHand(view: PlayerView, rng: Rng): Card[] {
  const { played, shown } = opponentPublicCards(view);
  const known = [...played, ...shown];
  const missing = 3 - known.length;
  const pool = unseenPool(view);
  const reads = readOpponent(view);

  /* v8 ignore next -- a seat always has three dealt cards */
  if (missing <= 0) return known.slice(0, 3);

  let fallback: Card[] | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = [...known, ...shuffle(pool, rng).slice(0, missing)];
    if (!isPossible(candidate, reads)) continue;
    fallback ??= candidate;
    // Accept proportionally to how well the hand explains what they have done.
    if (rng.int(1000) < plausibility(candidate, reads) * 1000) return candidate;
  }

  // Nothing passed the soft filter: fall back to any hand the record allows, or -- if
  // even the hard constraints could not be met -- to an unconstrained draw.
  return fallback ?? [...known, ...shuffle(pool, rng).slice(0, missing)];
}

/**
 * Turn a sampled opponent hand into a complete, *hypothetical* game state the engine
 * can roll out.
 *
 * This is the only way the AI ever obtains a `GameState`, and it is a guess it built
 * itself from public information -- never the real one. Two different real states
 * that look identical from this seat produce identical determinizations, which is
 * exactly the property the no-cheating test pins down.
 */
export function determinize(view: PlayerView, opponentDealt: readonly Card[]): GameState {
  const me = view.me;
  const opponent = opponentOf(me);

  const playedIds = new Set<string>();
  for (const trick of view.tricks) {
    for (const play of trick.plays) {
      if (play.player === opponent) playedIds.add(cardId(play.card));
    }
  }
  const opponentHand = opponentDealt.filter((card) => !playedIds.has(cardId(card)));

  const dealtIds = new Set([...view.myDealtHand, ...opponentDealt].map(cardId));
  const undealt = FULL_DECK.filter((card) => !dealtIds.has(cardId(card)));

  const tricks: Trick[] = view.tricks.map((trick) => ({
    plays: trick.plays.map((play) => ({ player: play.player, card: play.card })),
    outcome: trick.outcome,
  }));

  const hands = { [me]: [...view.myHand], [opponent]: opponentHand } as Record<PlayerId, Card[]>;
  const dealt = { [me]: [...view.myDealtHand], [opponent]: [...opponentDealt] } as Record<
    PlayerId,
    Card[]
  >;
  const { shown } = opponentPublicCards(view);
  const revealed = { [me]: [], [opponent]: shown } as Record<PlayerId, Card[]>;

  return {
    config: view.config,
    scores: { ...view.scores },
    handNumber: view.handNumber,
    mano: view.mano,
    turn: view.turn,
    playTurn: view.playTurn,
    phase: view.phase,
    hands,
    dealt,
    undealt,
    tricks,
    truco: {
      level: view.truco.level,
      pending: view.truco.pending,
      wordHolder: view.truco.wordHolder,
    },
    envido: {
      chain: [...view.envido.chain],
      pending: view.envido.pending,
      declarations: view.envido.declarations.map((entry) => ({ ...entry })),
      resolved: view.envido.resolved,
    },
    flor: {
      chain: [...view.flor.chain],
      pending: view.flor.pending,
      announced: [...view.flor.announced],
      resolved: view.flor.resolved,
    },
    trucoInterrupted: view.truco.parked,
    revealed,
    log: [],
    emitted: [],
    seq: 0,
    lastHandResult: view.lastHandResult,
    winner: view.winner,
  };
}

import type { Card, PlayerView } from '@truco/shared';

export const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

/**
 * A plausible `PlayerView` for component tests.
 *
 * Written out by hand rather than imported from the engine: the web app is not
 * allowed to depend on `@truco/engine`, and a test that reached for it would quietly
 * undo the boundary the whole design rests on.
 */
export function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  const base: PlayerView = {
    me: 'human',
    opponent: 'ai',
    config: {
      target: 30,
      flor: false,
      faltaEnvidoMode: 'classic',
      mazoPrimeraPenalty: true,
      difficulty: 'normal',
      playerName: 'Vos',
    },
    scores: { human: 0, ai: 0 },
    handNumber: 1,
    mano: 'human',
    turn: 'human',
    playTurn: 'human',
    phase: 'playing',
    myHand: [c(1, 'espada'), c(7, 'oro'), c(4, 'copa')],
    myDealtHand: [c(1, 'espada'), c(7, 'oro'), c(4, 'copa')],
    myEnvidoPoints: 7,
    myHandStrength: 0.6,
    iHaveFlor: false,
    opponentCardCount: 3,
    knownOpponentCards: [],
    tricks: [{ plays: [], outcome: null }],
    currentTrick: 0,
    truco: { level: 0, value: 1, pending: null, wordHolder: null, parked: null },
    envido: {
      chain: [],
      pending: null,
      declarations: [],
      resolved: null,
      stillAvailable: true,
    },
    flor: { chain: [], pending: null, announced: [], resolved: null },
    legalActions: [],
    log: [],
    lastHandResult: null,
    winner: null,
  };
  return { ...base, ...overrides };
}

import type { Action, Card, GameEvent, PlayerId } from '@truco/shared';
import { SUIT_LABEL } from '@truco/shared';

/** What the buttons say. Rioplatense, the way it is actually said at a table. */
export const ACTION_LABEL: Readonly<Record<Action['type'], string>> = {
  playCard: 'Jugar',
  truco: '¡Truco!',
  retruco: '¡Quiero retruco!',
  valeCuatro: '¡Quiero vale cuatro!',
  envido: 'Envido',
  realEnvido: 'Real envido',
  faltaEnvido: 'Falta envido',
  flor: '¡Flor!',
  contraflor: 'Contraflor',
  contraflorAlResto: 'Contraflor al resto',
  quiero: 'Quiero',
  noQuiero: 'No quiero',
  declarePoints: 'Cantar mis puntos',
  sonBuenas: 'Son buenas',
  irseAlMazo: 'Me voy al mazo',
  nextHand: 'Siguiente mano',
};

/** Single-key shortcuts. Shown on the buttons and bound globally. */
export const ACTION_SHORTCUT: Partial<Record<Action['type'], string>> = {
  truco: 't',
  retruco: 'r',
  valeCuatro: 'v',
  envido: 'e',
  realEnvido: 'd',
  faltaEnvido: 'f',
  flor: 'l',
  contraflor: 'c',
  contraflorAlResto: 'x',
  quiero: 'q',
  noQuiero: 'n',
  declarePoints: 'p',
  sonBuenas: 'b',
  irseAlMazo: 'm',
  nextHand: ' ',
};

/** Grouping for the action bar, so answers never sit next to a fold button. */
export const ACTION_TONE: Readonly<
  Record<Action['type'], 'bet' | 'accept' | 'refuse' | 'neutral'>
> = {
  playCard: 'neutral',
  truco: 'bet',
  retruco: 'bet',
  valeCuatro: 'bet',
  envido: 'bet',
  realEnvido: 'bet',
  faltaEnvido: 'bet',
  flor: 'bet',
  contraflor: 'bet',
  contraflorAlResto: 'bet',
  quiero: 'accept',
  noQuiero: 'refuse',
  declarePoints: 'accept',
  sonBuenas: 'refuse',
  irseAlMazo: 'refuse',
  nextHand: 'neutral',
};

export const cardAria = (card: Card): string => `${card.rank} de ${SUIT_LABEL[card.suit]}`;

/** What the AI says out loud. Kept short, the way a call actually sounds. */
export function speechFor(event: GameEvent, playerName: string): string | null {
  switch (event.type) {
    case 'called':
      return ACTION_LABEL[event.call];
    case 'responded':
      return event.response === 'quiero' ? '¡Quiero!' : 'No quiero';
    case 'pointsDeclared':
      return `${event.points}`;
    case 'sonBuenas':
      return 'Son buenas';
    case 'wentToDeck':
      return 'Me voy al mazo';
    case 'envidoResolved':
    case 'florResolved':
      return null;
    case 'gameEnded':
      return event.winner === 'ai' ? '¡Buena partida!' : `¡Bien ahí, ${playerName}!`;
    default:
      return null;
  }
}

export const playerLabel = (player: PlayerId, playerName: string): string =>
  player === 'human' ? playerName : 'La máquina';

const REASON_TEXT: Record<string, string> = {
  tricks: 'por las bazas',
  trucoRejected: 'porque no quisieron el canto',
  mazo: 'porque se fueron al mazo',
  target: 'y llegó a los puntos',
};

export function handResultText(
  result: { winner: PlayerId; points: number; reason: string },
  playerName: string,
): string {
  const who = playerLabel(result.winner, playerName);
  const points = result.points === 1 ? '1 punto' : `${result.points} puntos`;
  return `${who} se lleva ${points} ${REASON_TEXT[result.reason] ?? ''}`.trim();
}

export const trickOutcomeText = (
  outcome: PlayerId | 'parda' | null,
  playerName: string,
): string => {
  if (outcome === null) return '';
  if (outcome === 'parda') return 'Parda';
  return playerLabel(outcome, playerName);
};

export const DIFFICULTY_LABEL = {
  facil: 'Fácil',
  normal: 'Normal',
  dificil: 'Difícil',
} as const;

export const DIFFICULTY_BLURB = {
  facil: 'Juega de memoria y se manda cualquiera. Para arrancar.',
  normal: 'Mide la mano y canta con criterio.',
  dificil: 'Simula miles de manos, lee el marcador y te farolea.',
} as const;

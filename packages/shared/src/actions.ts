import { z } from 'zod';
import { isCardId } from './cards.js';

const CardIdSchema = z.string().refine(isCardId, { message: 'unknown card id' });

/**
 * Every move a player can make. Note what is *absent*: `declarePoints` carries no
 * number. The engine reads the real envido value off the player's dealt hand, so a
 * client cannot lie about its points and never needs to know the opponent's.
 */
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('playCard'), card: CardIdSchema }),

  z.object({ type: z.literal('truco') }),
  z.object({ type: z.literal('retruco') }),
  z.object({ type: z.literal('valeCuatro') }),

  z.object({ type: z.literal('envido') }),
  z.object({ type: z.literal('realEnvido') }),
  z.object({ type: z.literal('faltaEnvido') }),

  z.object({ type: z.literal('flor') }),
  z.object({ type: z.literal('contraflor') }),
  z.object({ type: z.literal('contraflorAlResto') }),

  z.object({ type: z.literal('quiero') }),
  z.object({ type: z.literal('noQuiero') }),

  z.object({ type: z.literal('declarePoints') }),
  z.object({ type: z.literal('sonBuenas') }),

  z.object({ type: z.literal('irseAlMazo') }),

  /** Deal the next hand. Legal only once the previous hand has been scored. */
  z.object({ type: z.literal('nextHand') }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];

export const TRUCO_CALLS = ['truco', 'retruco', 'valeCuatro'] as const;
export type TrucoCall = (typeof TRUCO_CALLS)[number];

export const ENVIDO_CALLS = ['envido', 'realEnvido', 'faltaEnvido'] as const;
export type EnvidoCall = (typeof ENVIDO_CALLS)[number];

export const FLOR_CALLS = ['flor', 'contraflor', 'contraflorAlResto'] as const;
export type FlorCall = (typeof FLOR_CALLS)[number];

export const sameAction = (a: Action, b: Action): boolean =>
  a.type === b.type && (a.type !== 'playCard' || b.type !== 'playCard' || a.card === b.card);

/** Stable key for an action, handy for maps and for `data-testid`s in the UI. */
export const actionKey = (action: Action): string =>
  action.type === 'playCard' ? `playCard:${action.card}` : action.type;

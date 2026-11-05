import { z } from 'zod';
import { ActionSchema } from './actions.js';
import { isCardId } from './cards.js';
import type { GameEvent } from './events.js';
import { GameConfigSchema } from './config.js';

/* ------------------------------------------------------ client -> server ---- */

/**
 * Everything the browser is allowed to say. Validated with these schemas on arrival,
 * before the engine sees any of it: the server treats the client as untrusted input,
 * not as a participant that knows the rules.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('newGame'), config: GameConfigSchema.partial().default({}) }),
  z.object({ type: z.literal('action'), action: ActionSchema }),
  /** Re-send the current view, e.g. after reconnecting. */
  z.object({ type: z.literal('resync') }),
  z.object({ type: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/* ------------------------------------------------------ server -> client ---- */

const SuitSchema = z.enum(['espada', 'basto', 'oro', 'copa']);
const RankSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(10),
  z.literal(11),
  z.literal(12),
]);
const CardSchema = z.object({ rank: RankSchema, suit: SuitSchema });
const PlayerIdSchema = z.enum(['human', 'ai']);
const TrickOutcomeSchema = z.union([PlayerIdSchema, z.literal('parda')]);
const PhaseSchema = z.enum([
  'playing',
  'trucoResponse',
  'envidoResponse',
  'envidoDeclaring',
  'florResponse',
  'handOver',
  'gameOver',
]);

const pendingCall = <T extends z.ZodTypeAny>(call: T) =>
  z.object({ by: PlayerIdSchema, call }).nullable();

const ScoresSchema = z.object({ human: z.number().int().min(0), ai: z.number().int().min(0) });

const CardIdSchema = z.string().refine(isCardId, { message: 'unknown card id' });
const TrucoCallSchema = z.enum(['truco', 'retruco', 'valeCuatro']);
const EnvidoCallSchema = z.enum(['envido', 'realEnvido', 'faltaEnvido']);
const FlorCallSchema = z.enum(['flor', 'contraflor', 'contraflorAlResto']);

const seq = z.number().int().nonnegative();
const resolution = z.object({
  winner: PlayerIdSchema,
  points: z.number().int(),
  wanted: z.boolean(),
});

/**
 * The event feed, validated as a real discriminated union rather than waved through.
 * The client renders the log and the animations off these, so a shape it does not
 * recognise should be rejected at the boundary, not halfway through a component.
 */
const GameEventSchema = z.discriminatedUnion('type', [
  z.object({
    seq,
    type: z.literal('handDealt'),
    handNumber: z.number().int().positive(),
    mano: PlayerIdSchema,
  }),
  z.object({
    seq,
    type: z.literal('cardPlayed'),
    player: PlayerIdSchema,
    card: CardIdSchema,
    trick: z.number().int().min(0).max(2),
  }),
  z.object({
    seq,
    type: z.literal('trickResolved'),
    trick: z.number().int().min(0).max(2),
    outcome: TrickOutcomeSchema,
  }),
  z.object({
    seq,
    type: z.literal('called'),
    player: PlayerIdSchema,
    call: z.union([TrucoCallSchema, EnvidoCallSchema, FlorCallSchema]),
  }),
  z.object({
    seq,
    type: z.literal('responded'),
    player: PlayerIdSchema,
    response: z.enum(['quiero', 'noQuiero']),
  }),
  z.object({
    seq,
    type: z.literal('pointsDeclared'),
    player: PlayerIdSchema,
    points: z.number().int(),
  }),
  z.object({ seq, type: z.literal('sonBuenas'), player: PlayerIdSchema }),
  z.object({ seq, type: z.literal('envidoResolved') }).extend(resolution.shape),
  z.object({ seq, type: z.literal('florResolved') }).extend(resolution.shape),
  z.object({
    seq,
    type: z.literal('cardsRevealed'),
    player: PlayerIdSchema,
    cards: z.array(CardIdSchema).max(3),
    reason: z.enum(['envido', 'flor']),
  }),
  z.object({ seq, type: z.literal('wentToDeck'), player: PlayerIdSchema }),
  z.object({
    seq,
    type: z.literal('handEnded'),
    winner: PlayerIdSchema,
    points: z.number().int(),
    reason: z.enum(['tricks', 'trucoRejected', 'mazo', 'target']),
  }),
  z.object({ seq, type: z.literal('scoreChanged'), scores: ScoresSchema }),
  z.object({ seq, type: z.literal('gameEnded'), winner: PlayerIdSchema }),
]) satisfies z.ZodType<GameEvent>;

/**
 * The `PlayerView` as it travels over the wire. Deliberately structural rather than
 * derived from the TypeScript type: the client validates what it receives, so a
 * server that changed shape is caught at the boundary instead of further in.
 */
export const PlayerViewSchema = z.object({
  me: PlayerIdSchema,
  opponent: PlayerIdSchema,
  config: GameConfigSchema,

  scores: ScoresSchema,
  handNumber: z.number().int().positive(),
  mano: PlayerIdSchema,
  turn: PlayerIdSchema,
  playTurn: PlayerIdSchema,
  phase: PhaseSchema,

  myHand: z.array(CardSchema).max(3),
  myDealtHand: z.array(CardSchema).max(3),
  myEnvidoPoints: z.number().int().min(0).max(33),
  myHandStrength: z.number().min(0).max(1),
  iHaveFlor: z.boolean(),

  opponentCardCount: z.number().int().min(0).max(3),
  knownOpponentCards: z.array(CardSchema).max(3),

  tricks: z.array(
    z.object({
      plays: z.array(z.object({ player: PlayerIdSchema, card: CardSchema })).max(2),
      outcome: TrickOutcomeSchema.nullable(),
    }),
  ),
  currentTrick: z.number().int().min(0).max(3),

  truco: z.object({
    level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    value: z.number().int().positive(),
    pending: pendingCall(z.enum(['truco', 'retruco', 'valeCuatro'])),
    wordHolder: PlayerIdSchema.nullable(),
    parked: pendingCall(z.enum(['truco', 'retruco', 'valeCuatro'])),
  }),
  envido: z.object({
    chain: z.array(z.enum(['envido', 'realEnvido', 'faltaEnvido'])),
    pending: pendingCall(z.enum(['envido', 'realEnvido', 'faltaEnvido'])),
    declarations: z.array(
      z.object({
        player: PlayerIdSchema,
        points: z.union([z.number().int(), z.literal('buenas')]),
      }),
    ),
    resolved: z
      .object({ winner: PlayerIdSchema, points: z.number().int(), wanted: z.boolean() })
      .nullable(),
    stillAvailable: z.boolean(),
  }),
  flor: z.object({
    chain: z.array(z.enum(['flor', 'contraflor', 'contraflorAlResto'])),
    pending: pendingCall(z.enum(['flor', 'contraflor', 'contraflorAlResto'])),
    announced: z.array(PlayerIdSchema),
    resolved: z
      .object({ winner: PlayerIdSchema, points: z.number().int(), wanted: z.boolean() })
      .nullable(),
  }),

  legalActions: z.array(ActionSchema),
  log: z.array(GameEventSchema),

  lastHandResult: z
    .object({
      winner: PlayerIdSchema,
      points: z.number().int(),
      reason: z.enum(['tricks', 'trucoRejected', 'mazo', 'target']),
    })
    .nullable(),
  winner: PlayerIdSchema.nullable(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('view'), view: PlayerViewSchema, sessionId: z.string() }),
  /** Animation feed: one batch of events per applied action. */
  z.object({ type: z.literal('events'), events: z.array(GameEventSchema) }),
  /** The AI is about to move; the UI can show it thinking. */
  z.object({ type: z.literal('thinking'), ms: z.number().int().nonnegative() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('pong') }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const encode = (message: ServerMessage): string => JSON.stringify(message);

/** Parse an untrusted frame. Returns `null` rather than throwing on malformed input. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ServerMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}

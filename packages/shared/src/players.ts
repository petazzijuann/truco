/**
 * Seat labels. The engine is seat-neutral -- these are just the two seats, and the
 * AI benchmark happily seats two bots. In the product, `human` is the browser and
 * `ai` is the bot running on the server.
 */
export const PLAYER_IDS = ['human', 'ai'] as const;
export type PlayerId = (typeof PLAYER_IDS)[number];

export const opponentOf = (player: PlayerId): PlayerId => (player === 'human' ? 'ai' : 'human');

/** A trick is won by a player, or tied ("parda"). */
export type TrickOutcome = PlayerId | 'parda';

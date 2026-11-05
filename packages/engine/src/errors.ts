import type { Action, PlayerId } from '@truco/shared';

/**
 * Thrown when a seat tries something `getLegalActions` does not offer. The server
 * turns this into a protocol error and leaves the game state untouched -- the client
 * is never trusted to know the rules.
 */
export class IllegalActionError extends Error {
  readonly player: PlayerId;
  readonly action: Action;

  constructor(player: PlayerId, action: Action, detail: string) {
    super(`illegal action for ${player}: ${action.type} (${detail})`);
    this.name = 'IllegalActionError';
    this.player = player;
    this.action = action;
  }
}

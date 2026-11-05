import { randomUUID } from 'node:crypto';
import {
  GameConfigSchema,
  type Action,
  type GameConfig,
  type GameConfigPatch,
  type GameEvent,
  type PlayerView,
  type Rng,
} from '@truco/shared';
import {
  IllegalActionError,
  applyAction,
  createGame,
  getPlayerView,
  type GameState,
} from '@truco/engine';
import { decide, thinkingDelayMs, type AIConfig } from '@truco/ai';
import { cryptoRng } from './rng.js';

/** The seat the browser plays. The AI always sits opposite. */
export const HUMAN = 'human' as const;
export const AI = 'ai' as const;

export type SessionUpdate =
  | { type: 'view'; view: PlayerView }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'thinking'; ms: number };

export type SessionOptions = {
  config?: GameConfigPatch;
  rng?: Rng;
  /** Injected so tests can run without real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Pause between a finished hand and the next deal, so the UI can show the result. */
  handPauseMs?: number;
  /** Search budget handed to the AI. Also the safety ceiling on its thinking time. */
  aiBudgetMs?: number;
};

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Beyond this the AI is considered stuck and the safe fallback is played instead. */
const AI_HARD_TIMEOUT_MS = 3_000;

/**
 * One game of truco against the AI.
 *
 * The session owns the only copy of the `GameState`. Nothing outside this class can
 * read it: callers get a `PlayerView` for the human seat, and the AI gets a
 * `PlayerView` for its own seat. Both go through `getPlayerView`.
 */
export class GameSession {
  readonly id: string;

  private gameConfig: GameConfig;
  private state: GameState;
  private readonly rng: Rng;
  private aiConfig: AIConfig;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly handPauseMs: number;
  private listener: ((update: SessionUpdate) => void) | null = null;
  /** Guards the AI loop so two actions can never interleave. */
  private running = false;
  /**
   * Bumped whenever the game underneath is replaced. The AI's turn spans a real
   * pause -- it is pretending to think -- and a `newGame` arriving during that pause
   * would otherwise land a move computed for a game that no longer exists.
   */
  private generation = 0;

  lastSeenAt: number;

  constructor(options: SessionOptions = {}) {
    this.id = randomUUID();
    this.gameConfig = GameConfigSchema.parse(options.config ?? {});
    this.rng = options.rng ?? cryptoRng;
    this.sleep = options.sleep ?? realSleep;
    this.handPauseMs = options.handPauseMs ?? 2_200;
    this.aiConfig = {
      difficulty: this.gameConfig.difficulty,
      rng: this.rng,
      ...(options.aiBudgetMs === undefined ? {} : { budgetMs: options.aiBudgetMs }),
    };
    this.state = createGame(this.gameConfig, this.rng);
    this.lastSeenAt = Date.now();
  }

  get config(): GameConfig {
    return this.gameConfig;
  }

  /** The human's view. The only way state leaves this object. */
  view(): PlayerView {
    return getPlayerView(this.state, HUMAN);
  }

  get phase(): GameState['phase'] {
    return this.state.phase;
  }

  get finished(): boolean {
    return this.state.winner !== null;
  }

  subscribe(listener: (update: SessionUpdate) => void): void {
    this.listener = listener;
  }

  unsubscribe(): void {
    this.listener = null;
  }

  private emit(update: SessionUpdate): void {
    this.listener?.(update);
  }

  private push(events: GameEvent[]): void {
    if (events.length > 0) this.emit({ type: 'events', events });
    this.emit({ type: 'view', view: this.view() });
  }

  /**
   * Apply a move from the browser.
   *
   * The action has already been schema-validated; here it is checked against the
   * rules. An illegal or out-of-turn move is rejected and the state is left exactly
   * as it was -- the client's idea of what is legal carries no authority.
   */
  submit(action: Action): { ok: true } | { ok: false; code: string; message: string } {
    this.lastSeenAt = Date.now();

    if (this.running) {
      return { ok: false, code: 'busy', message: 'Esperá, está jugando la IA.' };
    }
    if (this.state.winner !== null) {
      return { ok: false, code: 'gameOver', message: 'La partida ya terminó.' };
    }

    try {
      this.state = applyAction(this.state, HUMAN, action, this.rng);
    } catch (error) {
      if (error instanceof IllegalActionError) {
        return { ok: false, code: 'illegalAction', message: 'Esa jugada no es legal ahora.' };
      }
      /* v8 ignore next 2 -- anything else is a bug, not bad input */
      throw error;
    }

    this.push(this.state.emitted);
    this.kickOff();
    return { ok: true };
  }

  /**
   * Drive everything that does not need the human: the AI's moves, and dealing the
   * next hand once one is scored. Runs until it is the human's turn again.
   */
  async advance(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    const current = () => generation === this.generation;

    try {
      let guard = 0;
      while (this.state.winner === null && current()) {
        /* v8 ignore next -- a hand always makes progress */
        if (guard++ > 200) throw new Error('session failed to make progress');

        if (this.state.phase === 'handOver') {
          await this.sleep(this.handPauseMs);
          if (!current()) return;
          this.state = applyAction(this.state, HUMAN, { type: 'nextHand' }, this.rng);
          this.push(this.state.emitted);
          continue;
        }

        if (this.state.turn !== AI) break;
        if (!(await this.takeAiTurn(current))) return;
      }
    } finally {
      // Only release the lock if this loop still owns it: a restart hands ownership
      // to the loop it started, and clobbering that would strand the new game.
      if (current()) this.running = false;
    }
  }

  /** Returns false when the game was replaced while the AI was thinking. */
  private async takeAiTurn(current: () => boolean): Promise<boolean> {
    const view = getPlayerView(this.state, AI);
    const delay = thinkingDelayMs(view, this.aiConfig, this.rng);
    this.emit({ type: 'thinking', ms: delay });

    const started = Date.now();
    const action = this.chooseAiAction(view);
    const elapsed = Date.now() - started;

    // Think for as long as it said it would, minus the time actually spent deciding.
    await this.sleep(Math.max(0, delay - elapsed));
    if (!current()) return false;

    this.state = applyAction(this.state, AI, action, this.rng);
    this.push(this.state.emitted);
    return true;
  }

  /**
   * Ask the AI for a move, with a safety net. The search honours `budgetMs`, so this
   * should never fire; if it somehow does -- a bug, a pathological hand -- the session
   * plays the first legal action rather than hanging the game.
   */
  private chooseAiAction(view: PlayerView): Action {
    const started = Date.now();
    try {
      const action = decide(view, this.aiConfig);
      const elapsed = Date.now() - started;
      if (elapsed > AI_HARD_TIMEOUT_MS) {
        console.warn(`ai took ${elapsed}ms to decide (session ${this.id})`);
      }
      return action;
    } catch (error) {
      console.error(`ai failed to decide in session ${this.id}:`, error);
      const fallback = view.legalActions[0];
      /* v8 ignore next -- the engine always offers the seat on turn something to do */
      if (fallback === undefined) throw error;
      return fallback;
    }
  }

  /** Start a brand-new game, keeping the same session (and the same socket). */
  restart(config?: GameConfigPatch): void {
    // Abandon any AI turn still in flight, and take the lock back for the new game.
    this.generation += 1;
    this.running = false;
    this.gameConfig = GameConfigSchema.parse({ ...this.gameConfig, ...(config ?? {}) });
    this.aiConfig = { ...this.aiConfig, difficulty: this.gameConfig.difficulty };
    this.state = createGame(this.gameConfig, this.rng);
    this.push(this.state.emitted);
    this.kickOff();
  }

  /**
   * Let the AI act without making the caller wait. Failures are logged rather than
   * becoming an unhandled rejection that would take the process down.
   */
  kickOff(): void {
    void this.advance().catch((error: unknown) => {
      console.error(`session ${this.id} failed while advancing:`, error);
    });
  }
}

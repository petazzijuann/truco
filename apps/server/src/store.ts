import type { GameConfigPatch } from '@truco/shared';
import { GameSession, type SessionOptions } from './session.js';

export type StoreOptions = {
  /** Sessions untouched for this long are dropped. */
  ttlMs?: number;
  /** Refuse to create more than this many at once. */
  maxSessions?: number;
  defaults?: Omit<SessionOptions, 'config'>;
};

/**
 * In-memory session registry.
 *
 * Games live in process, which is all a single-player game against a bot needs. The
 * TTL sweep is what keeps an abandoned tab from leaking a game forever; `maxSessions`
 * is a crude but effective cap on how much one host can be made to hold.
 */
export class SessionStore {
  private readonly sessions = new Map<string, GameSession>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly defaults: Omit<SessionOptions, 'config'>;

  constructor(options: StoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 2 * 60 * 60 * 1_000;
    this.maxSessions = options.maxSessions ?? 500;
    this.defaults = options.defaults ?? {};
  }

  get size(): number {
    return this.sessions.size;
  }

  create(config?: GameConfigPatch): GameSession {
    this.sweep();
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('too many active sessions');
    }
    const session = new GameSession({
      ...this.defaults,
      ...(config === undefined ? {} : { config }),
    });
    this.sessions.set(session.id, session);
    return session;
  }

  /** Look up a session and mark it as alive. */
  get(id: string | undefined): GameSession | undefined {
    if (id === undefined) return undefined;
    const session = this.sessions.get(id);
    if (session === undefined) return undefined;
    session.lastSeenAt = Date.now();
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  /** Drop everything idle for longer than the TTL. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastSeenAt > this.ttlMs) {
        session.unsubscribe();
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    for (const session of this.sessions.values()) session.unsubscribe();
    this.sessions.clear();
  }
}

/**
 * A token bucket, one per connection.
 *
 * The client is allowed bursts -- a fast player clicking through a hand is normal --
 * but not an unbounded stream. Exceeding the bucket costs the message, not the
 * connection, so a buggy client degrades instead of dropping.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly capacity = 30,
    private readonly refillPerSecond = 8,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefillAt = now;
  }

  /** `true` when the message may proceed. */
  take(now = Date.now()): boolean {
    const elapsedSeconds = (now - this.lastRefillAt) / 1_000;
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
      this.lastRefillAt = now;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

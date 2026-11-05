import { describe, expect, it } from 'vitest';
import { cardId, seededRng, type PlayerView } from '@truco/shared';
import { GameSession, type SessionOptions, type SessionUpdate } from './session.js';
import { RateLimiter, SessionStore } from './store.js';

const noWait = () => Promise.resolve();

const makeSession = (over: SessionOptions = {}) =>
  new GameSession({
    rng: seededRng(7),
    sleep: noWait,
    handPauseMs: 0,
    aiBudgetMs: 0,
    ...over,
  });

/** Collect everything the session pushes out. */
function recording(session: GameSession) {
  const updates: SessionUpdate[] = [];
  session.subscribe((update) => updates.push(update));
  return updates;
}

/** Play the human's side with the first legal action until the game ends. */
async function playOut(session: GameSession, limit = 500): Promise<void> {
  await session.advance();
  for (let step = 0; step < limit && !session.finished; step++) {
    const view = session.view();
    const action = view.legalActions[0];
    if (action === undefined) {
      await session.advance();
      continue;
    }
    session.submit(action);
    await session.advance();
  }
}

describe('GameSession', () => {
  it('deals a game and exposes only the human view', () => {
    const session = makeSession();
    const view = session.view();
    expect(view.me).toBe('human');
    expect(view.myHand).toHaveLength(3);
    expect(view.opponentCardCount).toBe(3);
    expect(view.knownOpponentCards).toEqual([]);
  });

  it('rejects an illegal action and leaves the game untouched', () => {
    const session = makeSession({ config: { difficulty: 'facil' } });
    const before = JSON.stringify(session.view());
    // A card from nobody's hand.
    const result = session.submit({ type: 'playCard', card: '1-espada' });
    if (session.view().myHand.some((card) => cardId(card) === '1-espada')) {
      // The deal happened to include it; use an action that is illegal regardless.
      expect(session.submit({ type: 'quiero' }).ok).toBe(false);
    } else {
      expect(result).toEqual({
        ok: false,
        code: 'illegalAction',
        message: 'Esa jugada no es legal ahora.',
      });
    }
    expect(JSON.stringify(session.view())).toBe(before);
  });

  it('rejects an out-of-turn action', async () => {
    // Keep dealing until the ai is mano, so the human has nothing legal to do.
    for (let seed = 1; seed < 40; seed++) {
      const session = makeSession({ rng: seededRng(seed) });
      if (session.view().turn === 'ai') {
        expect(session.view().legalActions).toEqual([]);
        const result = session.submit({ type: 'truco' });
        expect(result.ok).toBe(false);
        await session.advance();
        return;
      }
    }
    throw new Error('no seed produced an ai-mano deal');
  });

  it('refuses actions once the game is over', async () => {
    const session = makeSession({ config: { target: 15, difficulty: 'facil' } });
    await playOut(session);
    expect(session.finished).toBe(true);
    const result = session.submit({ type: 'truco' });
    expect(result).toEqual({ ok: false, code: 'gameOver', message: 'La partida ya terminó.' });
  });

  it('pushes events and then the refreshed view, in that order', () => {
    const session = makeSession();
    const updates = recording(session);
    const action = session.view().legalActions.find((candidate) => candidate.type === 'playCard');
    session.submit(action!);
    const kinds = updates.map((update) => update.type);
    expect(kinds[0]).toBe('events');
    expect(kinds).toContain('view');
  });

  it('announces that the ai is thinking before it moves', async () => {
    // Use real thinking delays but a zero sleep, so the announced number is the real one.
    const session = makeSession({ config: { difficulty: 'normal' } });
    const updates = recording(session);
    await playOut(session, 40);
    const thinking = updates.filter((update) => update.type === 'thinking');
    expect(thinking.length).toBeGreaterThan(0);
    for (const update of thinking) {
      if (update.type !== 'thinking') continue;
      expect(update.ms).toBeGreaterThanOrEqual(300);
      expect(update.ms).toBeLessThanOrEqual(1_800);
    }
  });

  it('deals the next hand by itself once one is scored', async () => {
    const session = makeSession({ config: { difficulty: 'facil' } });
    const first = session.view().handNumber;
    await playOut(session, 200);
    expect(session.view().handNumber).toBeGreaterThan(first);
  });

  it('plays whole games to a winner', async () => {
    const session = makeSession({ config: { target: 15, difficulty: 'normal' } });
    await playOut(session);
    const view = session.view();
    expect(view.winner).not.toBeNull();
    expect(view.scores[view.winner!]).toBeGreaterThanOrEqual(15);
    expect(session.phase).toBe('gameOver');
  });

  it('restarts into a fresh game, honouring a new config', async () => {
    const session = makeSession({ config: { target: 15, difficulty: 'facil' } });
    await playOut(session);
    expect(session.finished).toBe(true);

    session.restart({ target: 30, difficulty: 'dificil' });
    await session.advance();
    expect(session.finished).toBe(false);
    expect(session.config.target).toBe(30);
    expect(session.config.difficulty).toBe('dificil');
    expect(session.view().handNumber).toBe(1);
    expect(session.view().scores).toEqual({ human: 0, ai: 0 });
  });
});

describe('restarting mid-thought', () => {
  /** A sleep that can be released by hand, to park the ai mid-turn. */
  function controllableSleep() {
    const pending: (() => void)[] = [];
    const sleep = () => new Promise<void>((resolve) => pending.push(resolve));
    return { sleep, release: () => pending.splice(0).forEach((resolve) => resolve()) };
  }

  it('abandons the in-flight ai turn instead of applying it to the new game', async () => {
    const { sleep, release } = controllableSleep();
    // A deal where the ai is mano, so it is the ai that owes the first move.
    let session: GameSession | undefined;
    for (let seed = 1; seed < 40 && session === undefined; seed++) {
      const candidate = new GameSession({
        rng: seededRng(seed),
        sleep,
        handPauseMs: 0,
        aiBudgetMs: 0,
      });
      if (candidate.view().turn === 'ai') session = candidate;
    }
    if (session === undefined) throw new Error('no seed produced an ai-mano deal');

    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      // The ai starts thinking and parks inside the sleep.
      session.kickOff();
      await Promise.resolve();

      // The player hits "new game" while it is still thinking.
      session.restart({ target: 15 });
      const fresh = session.view();
      expect(fresh.handNumber).toBe(1);
      expect(fresh.config.target).toBe(15);

      // Releasing the old sleep must not touch the new game.
      release();
      await Promise.resolve();
      await Promise.resolve();
      release();
      await session.advance();
    } finally {
      console.error = original;
    }

    expect(errors).toEqual([]);
    expect(session.view().scores).toEqual({ human: 0, ai: 0 });
    expect(session.view().config.target).toBe(15);
  });

  it('keeps playing after a restart', async () => {
    const session = makeSession({ config: { target: 15, difficulty: 'facil' } });
    session.restart({ target: 15, difficulty: 'facil' });
    await playOut(session);
    expect(session.finished).toBe(true);
  });
});

describe('the human view never carries the ai hand', () => {
  /**
   * The payload test. Serialise every view the session hands out over a full game and
   * confirm that no card the ai still holds appears anywhere in the JSON -- not in the
   * view, not in the event feed, not in the log.
   */
  it('holds across whole games, for every pushed message', async () => {
    const session = makeSession({ config: { difficulty: 'normal' } });
    const updates = recording(session);
    await playOut(session, 400);

    // Reconstruct what the human could legitimately know at the end.
    const finalView = session.view();
    expect(finalView.winner).not.toBeNull();

    // Any card id anywhere in anything we ever sent.
    const everythingSent = JSON.stringify(updates);
    const seenByHuman = new Set<string>();
    for (const update of updates) {
      if (update.type !== 'view') continue;
      for (const card of update.view.myDealtHand) seenByHuman.add(cardId(card));
      for (const card of update.view.knownOpponentCards) seenByHuman.add(cardId(card));
      for (const trick of update.view.tricks) {
        for (const play of trick.plays) seenByHuman.add(cardId(play.card));
      }
    }

    // Count how many distinct cards were mentioned at all. Anything mentioned must be
    // one the human was entitled to see.
    const mentioned = new Set<string>();
    for (const match of everythingSent.matchAll(/"rank":(\d+),"suit":"(\w+)"/g)) {
      mentioned.add(`${match[1]}-${match[2]}`);
    }
    for (const match of everythingSent.matchAll(/"(\d{1,2}-(?:espada|basto|oro|copa))"/g)) {
      mentioned.add(match[1]!);
    }

    for (const id of mentioned) {
      expect(seenByHuman.has(id), `${id} was sent to the client but was never public`).toBe(true);
    }
    // Sanity: the test actually inspected a meaningful number of cards.
    expect(mentioned.size).toBeGreaterThan(6);
  });

  it('never exposes a legal action naming a card the human does not hold', async () => {
    const session = makeSession({ config: { difficulty: 'facil' } });
    const updates = recording(session);
    await playOut(session, 400);

    for (const update of updates) {
      if (update.type !== 'view') continue;
      const view: PlayerView = update.view;
      const own = new Set(view.myHand.map(cardId));
      for (const action of view.legalActions) {
        if (action.type === 'playCard') expect(own.has(action.card)).toBe(true);
      }
    }
  });
});

describe('SessionStore', () => {
  it('creates, finds and forgets sessions', () => {
    const store = new SessionStore({ defaults: { rng: seededRng(1), sleep: noWait } });
    const session = store.create({ target: 15 });
    expect(store.size).toBe(1);
    expect(store.get(session.id)).toBe(session);
    expect(store.get('nope')).toBeUndefined();
    expect(store.get(undefined)).toBeUndefined();
    store.delete(session.id);
    expect(store.size).toBe(0);
  });

  it('sweeps sessions past their ttl, and keeps live ones', () => {
    const store = new SessionStore({ ttlMs: 1_000, defaults: { sleep: noWait } });
    const stale = store.create();
    const fresh = store.create();
    stale.lastSeenAt = Date.now() - 5_000;
    expect(store.sweep()).toBe(1);
    expect(store.get(fresh.id)).toBe(fresh);
    expect(store.get(stale.id)).toBeUndefined();
  });

  it('a lookup keeps a session alive', () => {
    const store = new SessionStore({ ttlMs: 1_000, defaults: { sleep: noWait } });
    const session = store.create();
    session.lastSeenAt = Date.now() - 5_000;
    store.get(session.id);
    expect(store.sweep()).toBe(0);
  });

  it('refuses to grow without bound', () => {
    const store = new SessionStore({ maxSessions: 2, defaults: { sleep: noWait } });
    store.create();
    store.create();
    expect(() => store.create()).toThrow(/too many active sessions/);
  });

  it('clears everything', () => {
    const store = new SessionStore({ defaults: { sleep: noWait } });
    store.create();
    store.create();
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe('RateLimiter', () => {
  it('allows a burst up to capacity and then refuses', () => {
    const limiter = new RateLimiter(3, 1, 0);
    expect(limiter.take(0)).toBe(true);
    expect(limiter.take(0)).toBe(true);
    expect(limiter.take(0)).toBe(true);
    expect(limiter.take(0)).toBe(false);
  });

  it('refills over time', () => {
    const limiter = new RateLimiter(2, 4, 0);
    expect(limiter.take(0)).toBe(true);
    expect(limiter.take(0)).toBe(true);
    expect(limiter.take(0)).toBe(false);
    // 250ms at 4 tokens/second is exactly one token.
    expect(limiter.take(250)).toBe(true);
    expect(limiter.take(250)).toBe(false);
  });

  it('never banks more than capacity', () => {
    const limiter = new RateLimiter(2, 10, 0);
    expect(limiter.take(10_000)).toBe(true);
    expect(limiter.take(10_000)).toBe(true);
    expect(limiter.take(10_000)).toBe(false);
  });
});

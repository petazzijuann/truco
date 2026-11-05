import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import {
  cardId,
  parseServerMessage,
  seededRng,
  type ClientMessage,
  type ServerMessage,
} from '@truco/shared';
import { buildApp, type AppOptions } from './app.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function startServer(options: AppOptions = {}): Promise<string> {
  app = await buildApp({
    sessionDefaults: {
      rng: seededRng(11),
      sleep: () => Promise.resolve(),
      handPauseMs: 0,
      aiBudgetMs: 0,
    },
    ...options,
  });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return address.replace('http://', 'ws://');
}

/** A small test client that records every frame the server sends. */
class TestClient {
  readonly received: ServerMessage[] = [];
  /** Frames the client's own schema rejected. Any of these is a protocol bug. */
  readonly rejected: string[] = [];
  private constructor(private readonly socket: WebSocket) {}

  static async connect(base: string, sessionId?: string): Promise<TestClient> {
    const url = sessionId === undefined ? `${base}/ws` : `${base}/ws?sessionId=${sessionId}`;
    const socket = new WebSocket(url);
    const client = new TestClient(socket);
    socket.on('message', (raw: Buffer) => {
      const message = parseServerMessage(raw.toString());
      // A frame the client's own schema rejects is a protocol bug. Throwing here would
      // be swallowed by the socket, so it is recorded and asserted on instead.
      if (message === null) client.rejected.push(raw.toString());
      else client.received.push(message);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  /**
   * Wait for a frame of a given type to arrive (or time out). Pass `from` -- a frame
   * count snapshotted before sending -- to ignore everything already received.
   */
  async waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 4_000,
    from = 0,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.received
        .slice(from)
        .find(
          (message): message is Extract<ServerMessage, { type: T }> =>
            message.type === type && predicate(message as Extract<ServerMessage, { type: T }>),
        );
      if (hit !== undefined) return hit;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  get views() {
    return this.received.filter((message) => message.type === 'view');
  }

  get latestView() {
    return this.views.at(-1);
  }

  /**
   * Keep answering with the first legal action until a view satisfies `predicate`.
   * The ai may be mano and may open with a call, so reaching a given situation
   * usually takes a few moves rather than none.
   */
  async driveUntil(
    predicate: (view: Extract<ServerMessage, { type: 'view' }>) => boolean,
    steps = 80,
  ): Promise<Extract<ServerMessage, { type: 'view' }>> {
    for (let step = 0; step < steps; step++) {
      const view = this.latestView;
      if (view !== undefined) {
        if (predicate(view)) return view;
        const action = view.view.legalActions[0];
        if (action !== undefined && view.view.winner === null) {
          this.send({ type: 'action', action });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error('never reached the requested situation');
  }

  /**
   * Wait until the server stops sending. An `events` frame and the `view` that
   * follows it arrive separately, so a snapshot taken between the two would see a
   * card named on the wire before the view that makes it public.
   */
  async settle(quietMs = 300, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let count = -1;
    while (Date.now() < deadline) {
      if (count === this.received.length) return;
      count = this.received.length;
      await new Promise((resolve) => setTimeout(resolve, quietMs));
    }
  }

  close(): void {
    this.socket.close();
  }
}

describe('websocket protocol', () => {
  it('serves health', async () => {
    const base = await startServer();
    const response = await app!.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ ok: true, sessions: 0 });
    expect(base).toMatch(/^ws:\/\//);
  });

  it('sends a view and a session id on connect', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    const first = await client.waitFor('view');
    expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.view.me).toBe('human');
    expect(first.view.myHand).toHaveLength(3);
    client.close();
  });

  it('answers a ping', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    client.send({ type: 'ping' });
    await client.waitFor('pong');
    client.close();
  });

  it('resyncs on request', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');
    const before = client.views.length;
    client.send({ type: 'resync' });
    await client.waitFor('view', () => client.views.length > before);
    client.close();
  });

  it('rejects a malformed frame without dropping the connection', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');

    client.sendRaw('not json at all');
    const error = await client.waitFor('error');
    expect(error.code).toBe('badMessage');

    // Still usable afterwards.
    client.send({ type: 'ping' });
    await client.waitFor('pong');
    client.close();
  });

  it('rejects a well-formed frame with an unknown action', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');
    client.sendRaw(JSON.stringify({ type: 'action', action: { type: 'cantarGol' } }));
    const error = await client.waitFor('error');
    expect(error.code).toBe('badMessage');
    client.close();
  });

  it('rejects a card id that is not in the deck', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');
    client.sendRaw(JSON.stringify({ type: 'action', action: { type: 'playCard', card: '8-oro' } }));
    const error = await client.waitFor('error');
    expect(error.code).toBe('badMessage');
    client.close();
  });

  it('rejects an illegal action and resyncs the client', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    // Wait until the human is on turn, then ask for the next deal mid-hand -- legal
    // only once a hand has been scored, so it is always wrong here.
    await client.waitFor('view');
    const view = await client.driveUntil(
      (message) => message.view.legalActions.length > 0 && message.view.phase !== 'handOver',
    );
    expect(view.view.phase).not.toBe('handOver');
    expect(view.view.legalActions.map((action) => action.type)).not.toContain('nextHand');

    const viewsBefore = client.views.length;
    client.send({ type: 'action', action: { type: 'nextHand' } });
    const error = await client.waitFor('error');
    expect(['illegalAction', 'busy']).toContain(error.code);
    // The rejection is followed by a resync, so a confused client recovers.
    await client.waitFor('view', () => client.views.length > viewsBefore);
    client.close();
  });

  it('applies a legal action and reports the events', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');
    // The ai may be mano and may open with a call, so play on until the human has a
    // card to put down.
    const view = await client.driveUntil((message) =>
      message.view.legalActions.some((action) => action.type === 'playCard'),
    );
    const card = view.view.legalActions.find((action) => action.type === 'playCard')!;
    const from = client.received.length;
    client.send({ type: 'action', action: card });

    const events = await client.waitFor(
      'events',
      (message) => message.events.some((event) => event.type === 'cardPlayed'),
      4_000,
      from,
    );
    const played = events.events.find((event) => event.type === 'cardPlayed');
    expect(played).toMatchObject({ player: 'human', card: card.card });
    client.close();
  });

  it('resumes the same game when the client reconnects with its id', async () => {
    const base = await startServer();
    const first = await TestClient.connect(base);
    const initial = await first.waitFor('view');
    const sessionId = initial.sessionId;
    const hand = initial.view.myDealtHand.map(cardId);
    first.close();

    const second = await TestClient.connect(base, sessionId);
    const resumed = await second.waitFor('view');
    expect(resumed.sessionId).toBe(sessionId);
    expect(resumed.view.myDealtHand.map(cardId)).toEqual(hand);
    second.close();
  });

  it('starts a new game for an unknown session id', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base, 'not-a-real-session');
    const view = await client.waitFor('view');
    expect(view.sessionId).not.toBe('not-a-real-session');
    expect(view.view.handNumber).toBe(1);
    client.close();
  });

  it('restarts on newGame, with the requested config', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');
    client.send({ type: 'newGame', config: { target: 15, flor: true, difficulty: 'facil' } });
    const view = await client.waitFor('view', (message) => message.view.config.target === 15);
    expect(view.view.config.flor).toBe(true);
    expect(view.view.config.difficulty).toBe('facil');
    client.close();
  });

  it('rate limits a flood but keeps the socket open', async () => {
    const base = await startServer({ rateLimit: { capacity: 5, refillPerSecond: 0.1 } });
    const client = await TestClient.connect(base);
    await client.waitFor('view');
    for (let i = 0; i < 25; i++) client.send({ type: 'ping' });
    const error = await client.waitFor('error');
    expect(error.code).toBe('rateLimited');
    expect(client.received.filter((message) => message.type === 'pong').length).toBeLessThanOrEqual(
      5,
    );
    client.close();
  });
});

describe('nothing on the wire names a hidden card', () => {
  it('holds for every frame of a game played over the socket', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');

    // Play the human's side with the first legal action, until a card has actually
    // reached the table. A fixed number of ticks is not enough: a tick can land while
    // it is the ai's turn, and the test would then inspect an empty hand of frames.
    for (let step = 0; step < 200; step++) {
      const view = client.views.at(-1);
      if (view === undefined) break;
      if (view.view.winner !== null) break;
      const played = view.view.tricks.some((trick) => trick.plays.length > 0);
      if (played && step > 10) break;
      const action = view.view.legalActions[0];
      if (action !== undefined) client.send({ type: 'action', action });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }

    await client.settle();
    client.close();
    // One snapshot for both halves of the comparison: frames keep arriving, and
    // deriving `allowed` and `wire` from different moments would race.
    const frames = [...client.received];

    // Everything the human was ever entitled to see.
    const allowed = new Set<string>();
    for (const message of frames) {
      if (message.type !== 'view') continue;
      for (const card of message.view.myDealtHand) allowed.add(cardId(card));
      for (const card of message.view.knownOpponentCards) allowed.add(cardId(card));
      for (const trick of message.view.tricks) {
        for (const play of trick.plays) allowed.add(cardId(play.card));
      }
    }

    const wire = JSON.stringify(frames);
    const mentioned = new Set<string>();
    for (const match of wire.matchAll(/"rank":(\d+),"suit":"(\w+)"/g)) {
      mentioned.add(`${match[1]}-${match[2]}`);
    }
    for (const match of wire.matchAll(/"(\d{1,2}-(?:espada|basto|oro|copa))"/g)) {
      mentioned.add(match[1]!);
    }

    // Every frame must satisfy the client's own schema; a dropped frame would make
    // the check above vacuous.
    expect(client.rejected).toEqual([]);

    // The human's own three cards are always named, so this pins the test down
    // exactly rather than hoping enough play happened.
    const ownHand = client.views.at(-1)!.view.myDealtHand.map(cardId);
    expect(ownHand).toHaveLength(3);
    for (const id of ownHand) expect(mentioned.has(id)).toBe(true);

    for (const id of mentioned) {
      expect(allowed.has(id), `${id} crossed the wire without ever being public`).toBe(true);
    }
  });

  it('keeps the opponent known-card list free of duplicates', async () => {
    const base = await startServer();
    const client = await TestClient.connect(base);
    await client.waitFor('view');

    // Just play for a while. A card can be both played face-up and shown for the
    // envido, and before the fix that produced a duplicate entry -- and a frame the
    // client's own schema rejected, which is what `rejected` catches.
    for (let step = 0; step < 200; step++) {
      const view = client.latestView;
      if (view === undefined || view.view.winner !== null) break;
      const action = view.view.legalActions[0];
      if (action !== undefined) client.send({ type: 'action', action });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await client.settle();

    expect(client.views.length).toBeGreaterThan(2);
    for (const message of client.views) {
      const ids = message.view.knownOpponentCards.map(cardId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(3);
    }
    expect(client.rejected).toEqual([]);
    client.close();
  });
});

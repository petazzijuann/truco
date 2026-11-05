import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { encode, parseClientMessage, type ServerMessage } from '@truco/shared';
import { RateLimiter, SessionStore } from './store.js';
import type { SessionOptions, SessionUpdate } from './session.js';

export type AppOptions = {
  /** Serve the built web app from here. Omitted in tests. */
  webRoot?: string;
  logger?: boolean;
  sessionDefaults?: Omit<SessionOptions, 'config'>;
  rateLimit?: { capacity: number; refillPerSecond: number };
};

const here = dirname(fileURLToPath(import.meta.url));

/** Where the web build lands in the Docker image and in a local `pnpm build`. */
export function defaultWebRoot(): string | undefined {
  const candidates = [
    resolve(here, 'public'),
    resolve(here, '..', 'public'),
    resolve(here, '..', '..', 'web', 'dist'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const store = new SessionStore({
    ...(options.sessionDefaults === undefined ? {} : { defaults: options.sessionDefaults }),
  });

  await app.register(fastifyWebsocket, {
    options: { maxPayload: 16 * 1024 },
  });

  app.get('/health', () => ({ ok: true, sessions: store.size }));

  app.get('/ws', { websocket: true }, (socket, request) => {
    const limiter = new RateLimiter(
      options.rateLimit?.capacity ?? 30,
      options.rateLimit?.refillPerSecond ?? 8,
    );

    const send = (message: ServerMessage): void => {
      if (socket.readyState === socket.OPEN) socket.send(encode(message));
    };

    const requested = new URL(request.url, 'http://localhost').searchParams.get('sessionId');
    // Reattach to an existing game when the client brings a known id, so a reload or
    // a dropped connection resumes rather than restarting.
    let session = store.get(requested ?? undefined);
    const resumed = session !== undefined;
    if (session === undefined) {
      try {
        session = store.create();
      } catch {
        send({
          type: 'error',
          code: 'capacity',
          message: 'El servidor está lleno, probá en un rato.',
        });
        socket.close();
        return;
      }
    }
    const current = session;

    const relay = (update: SessionUpdate): void => {
      switch (update.type) {
        case 'view':
          send({ type: 'view', view: update.view, sessionId: current.id });
          break;
        case 'events':
          send({ type: 'events', events: update.events });
          break;
        case 'thinking':
          send({ type: 'thinking', ms: update.ms });
          break;
      }
    };
    current.subscribe(relay);

    send({ type: 'view', view: current.view(), sessionId: current.id });
    // A fresh game may already be waiting on the AI (it can be mano).
    if (!resumed) current.kickOff();

    socket.on('message', (raw: Buffer | string) => {
      if (!limiter.take()) {
        send({
          type: 'error',
          code: 'rateLimited',
          message: 'Demasiados mensajes, bajá un cambio.',
        });
        return;
      }

      const message = parseClientMessage(raw.toString());
      if (message === null) {
        send({ type: 'error', code: 'badMessage', message: 'Mensaje inválido.' });
        return;
      }

      switch (message.type) {
        case 'ping':
          send({ type: 'pong' });
          break;

        case 'resync':
          send({ type: 'view', view: current.view(), sessionId: current.id });
          break;

        case 'newGame':
          current.restart(message.config);
          break;

        case 'action': {
          const result = current.submit(message.action);
          if (!result.ok) {
            send({ type: 'error', code: result.code, message: result.message });
            // Resync so a client with a stale idea of the position recovers.
            send({ type: 'view', view: current.view(), sessionId: current.id });
          }
          break;
        }
      }
    });

    socket.on('close', () => {
      // Keep the game around: the id lets the player come back to it.
      current.unsubscribe();
    });
  });

  const webRoot = options.webRoot ?? defaultWebRoot();
  if (webRoot !== undefined) {
    // `wildcard` is left on so files are resolved per request: the asset names are
    // content-hashed, and a startup-time listing would 404 everything after a rebuild.
    await app.register(fastifyStatic, { root: webRoot });
    // Single-page app: anything that is not a real file renders the shell.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/ws') || request.url.startsWith('/health')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', () => {
    store.clear();
  });

  return app;
}

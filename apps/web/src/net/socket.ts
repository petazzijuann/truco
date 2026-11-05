import { parseServerMessage, type ClientMessage, type ServerMessage } from '@truco/shared';

const SESSION_KEY = 'truco.sessionId';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type SocketHandlers = {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
};

function socketUrl(sessionId: string | null): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${window.location.host}/ws`;
  return sessionId === null ? base : `${base}?sessionId=${encodeURIComponent(sessionId)}`;
}

/**
 * The connection to the authoritative server.
 *
 * The client keeps no game state of its own beyond what arrives here: it does not
 * know the rules, it does not know the opponent's cards, and it cannot decide what
 * is legal. Everything it renders came out of a `PlayerView`.
 *
 * Reconnects with backoff and replays the stored session id, so a dropped Wi-Fi or a
 * reload resumes the same game instead of abandoning it.
 */
export class GameSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private closedByUs = false;
  private retryTimer: number | null = null;
  private readonly queue: ClientMessage[] = [];

  constructor(private readonly handlers: SocketHandlers) {}

  get sessionId(): string | null {
    try {
      return window.localStorage.getItem(SESSION_KEY);
    } catch {
      // Private browsing can refuse storage; a new game per load is an acceptable fallback.
      return null;
    }
  }

  private rememberSession(id: string): void {
    try {
      window.localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* ignore */
    }
  }

  forgetSession(): void {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  connect(): void {
    this.closedByUs = false;
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const socket = new WebSocket(socketUrl(this.sessionId));
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.handlers.onStatus('open');
      // Anything the player clicked while offline goes out now.
      while (this.queue.length > 0) socket.send(JSON.stringify(this.queue.shift()));
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = parseServerMessage(event.data);
      if (message === null) {
        console.warn('discarded an unparseable frame from the server');
        return;
      }
      if (message.type === 'view') this.rememberSession(message.sessionId);
      this.handlers.onMessage(message);
    });

    socket.addEventListener('close', () => {
      if (this.closedByUs) {
        this.handlers.onStatus('closed');
        return;
      }
      this.scheduleRetry();
    });

    socket.addEventListener('error', () => {
      // `close` always follows, which is where the retry is scheduled.
    });
  }

  private scheduleRetry(): void {
    this.handlers.onStatus('reconnecting');
    const delay = Math.min(8_000, 400 * 2 ** this.attempt);
    this.attempt += 1;
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    // Hold it until we are back, so a click during a blip is not simply lost.
    this.queue.push(message);
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
  }
}

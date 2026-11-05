import { create } from 'zustand';
import type {
  Action,
  GameConfigPatch,
  GameEvent,
  PlayerId,
  PlayerView,
  ServerMessage,
} from '@truco/shared';
import { GameSocket, type SocketStatus } from './net/socket.js';
import { playSound } from './sound.js';
import { speechFor } from './text.js';

export type Screen = 'home' | 'game' | 'rules';

export type Speech = { id: number; player: PlayerId; text: string };

export type Prefs = {
  sound: boolean;
  /** Show my own envido count and hand strength. Only ever my own cards. */
  help: boolean;
  playerName: string;
};

export type GameStore = {
  status: SocketStatus;
  /** The whole of what the client knows. There is no other source of game truth. */
  view: PlayerView | null;
  /** True while the server says the AI is deciding. */
  aiThinking: boolean;
  /** Transient message, e.g. a rejected action. */
  notice: string | null;
  /** Speech bubbles currently on screen, newest last. */
  speech: Speech[];
  /** Sequence number of the last event we reacted to, so a resync does not replay. */
  lastSeq: number;
  /** The trick index to flash as just-won, cleared after the animation. */
  highlightTrick: number | null;
  screen: Screen;
  prefs: Prefs;

  connect: () => void;
  disconnect: () => void;
  send: (action: Action) => void;
  newGame: (config: GameConfigPatch) => void;
  setScreen: (screen: Screen) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  dismissNotice: () => void;
  clearHighlight: () => void;
};

const PREFS_KEY = 'truco.prefs';

function loadPrefs(): Prefs {
  const fallback: Prefs = { sound: true, help: false, playerName: 'Vos' };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : fallback.sound,
      help: typeof parsed.help === 'boolean' ? parsed.help : fallback.help,
      playerName:
        typeof parsed.playerName === 'string' && parsed.playerName.trim().length > 0
          ? parsed.playerName.slice(0, 24)
          : fallback.playerName,
    };
  } catch {
    return fallback;
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

let socket: GameSocket | null = null;
let speechId = 0;

export const useGame = create<GameStore>((set, get) => ({
  status: 'closed',
  view: null,
  aiThinking: false,
  notice: null,
  speech: [],
  lastSeq: 0,
  highlightTrick: null,
  screen: 'home',
  prefs: loadPrefs(),

  connect: () => {
    if (socket !== null) return;
    socket = new GameSocket({
      onStatus: (status) => set({ status }),
      onMessage: (message) => handleMessage(message, set, get),
    });
    socket.connect();
  },

  disconnect: () => {
    socket?.close();
    socket = null;
    set({ status: 'closed' });
  },

  send: (action) => {
    const view = get().view;
    // A purely local guard so the UI stays honest; the server decides regardless.
    if (view === null) return;
    socket?.send({ type: 'action', action });
    if (action.type === 'playCard') playSound('card', get().prefs.sound);
    else playSound('call', get().prefs.sound);
  },

  newGame: (config) => {
    const prefs = get().prefs;
    socket?.send({ type: 'newGame', config: { ...config, playerName: prefs.playerName } });
    set({ speech: [], notice: null, lastSeq: 0, highlightTrick: null, screen: 'game' });
    playSound('shuffle', prefs.sound);
  },

  setScreen: (screen) => set({ screen }),

  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    savePrefs(prefs);
    set({ prefs });
  },

  dismissNotice: () => set({ notice: null }),
  clearHighlight: () => set({ highlightTrick: null }),
}));

type Setter = (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void;
type Getter = () => GameStore;

function handleMessage(message: ServerMessage, set: Setter, get: Getter): void {
  switch (message.type) {
    case 'view': {
      const previous = get().view;
      set({ view: message.view, aiThinking: false });
      // Entering the game screen the first time a view arrives mid-game, so a
      // reconnect drops the player back at the table rather than at the menu.
      if (previous === null && message.view.handNumber >= 1 && get().screen === 'home') {
        const started = message.view.scores.human > 0 || message.view.scores.ai > 0;
        if (started || message.view.tricks.some((trick) => trick.plays.length > 0)) {
          set({ screen: 'game' });
        }
      }
      break;
    }

    case 'events':
      reactToEvents(message.events, set, get);
      break;

    case 'thinking':
      set({ aiThinking: true });
      break;

    case 'error':
      set({ notice: message.message });
      break;

    case 'pong':
      break;
  }
}

/**
 * Turn the server's event feed into the transient parts of the UI: speech bubbles,
 * sounds, and the winning-card flash. The durable state always comes from the view.
 */
function reactToEvents(events: GameEvent[], set: Setter, get: Getter): void {
  const { lastSeq, prefs } = get();
  const fresh = events.filter((event) => event.seq > lastSeq);
  if (fresh.length === 0) return;

  const bubbles: Speech[] = [];
  let highlight: number | null = null;

  for (const event of fresh) {
    const text = speechFor(event, prefs.playerName);
    if (text !== null) {
      const player: PlayerId =
        'player' in event ? event.player : event.type === 'gameEnded' ? event.winner : 'ai';
      bubbles.push({ id: ++speechId, player, text });
    }

    switch (event.type) {
      case 'handDealt':
        playSound('shuffle', prefs.sound);
        set({ speech: [] });
        break;
      case 'cardPlayed':
        if (event.player === 'ai') playSound('card', prefs.sound);
        break;
      case 'trickResolved':
        highlight = event.trick;
        break;
      case 'called':
        if (event.player === 'ai') playSound('call', prefs.sound);
        break;
      case 'scoreChanged':
        playSound('point', prefs.sound);
        break;
      case 'gameEnded':
        playSound(event.winner === 'human' ? 'win' : 'lose', prefs.sound);
        break;
      default:
        break;
    }
  }

  const maxSeq = Math.max(...fresh.map((event) => event.seq));
  set((state) => ({
    lastSeq: Math.max(state.lastSeq, maxSeq),
    speech: [...state.speech, ...bubbles].slice(-3),
    highlightTrick: highlight ?? state.highlightTrick,
  }));
}

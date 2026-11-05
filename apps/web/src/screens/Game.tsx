import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cardId, type Action, type Card } from '@truco/shared';
import { PlayableCard } from '../cards/PlayableCard.js';
import { ActionBar } from '../components/ActionBar.js';
import { HandLog } from '../components/HandLog.js';
import { Scoreboard } from '../components/Scoreboard.js';
import { OpponentHand, SpeechBubbles, StakeBanner, TrickArea } from '../components/Table.js';
import { useGame } from '../store.js';
import { handResultText, playerLabel } from '../text.js';

/** How long the winning-card ring stays lit. */
const HIGHLIGHT_MS = 1_400;

function HelpPanel({
  points,
  strength,
  hasFlor,
}: {
  points: number;
  strength: number;
  hasFlor: boolean;
}) {
  const label =
    strength > 0.72 ? 'brava' : strength > 0.5 ? 'buena' : strength > 0.3 ? 'regular' : 'flojita';
  return (
    <div className="help-panel" aria-label="Modo ayuda: datos de tu propia mano">
      <span>
        Tu envido: <strong>{points}</strong>
      </span>
      <span>
        Tu mano: <strong>{label}</strong>
      </span>
      <div
        className="strength-meter"
        role="img"
        aria-label={`Fuerza ${Math.round(strength * 100)} sobre 100`}
      >
        <span style={{ width: `${Math.round(strength * 100)}%` }} />
      </div>
      {hasFlor && <span className="help-flor">¡Tenés flor!</span>}
    </div>
  );
}

function GameOver() {
  const { view, prefs, newGame, setScreen } = useGame();
  const reduceMotion = useReducedMotion();
  if (view === null || view.winner === null) return null;
  const won = view.winner === 'human';

  return (
    <motion.div
      className="game-over"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, backdropFilter: 'blur(0px)' }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="game-over-card"
        initial={reduceMotion ? false : { scale: 0.85, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <h2 id="game-over-title">{won ? '¡Ganaste!' : 'Perdiste'}</h2>
        <p className="game-over-score">
          {prefs.playerName} {view.scores.human} — {view.scores.ai} la máquina
        </p>
        <p className="game-over-detail">
          {won
            ? 'Bien jugado. ¿Otra?'
            : `${playerLabel('ai', prefs.playerName)} se la llevó. Revancha y vemos.`}
        </p>
        <div className="game-over-actions">
          <button type="button" className="primary" onClick={() => newGame(view.config)}>
            Revancha
          </button>
          <button type="button" className="ghost" onClick={() => setScreen('home')}>
            Cambiar opciones
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function Game() {
  const {
    view,
    prefs,
    speech,
    aiThinking,
    highlightTrick,
    clearHighlight,
    send,
    setScreen,
    setPrefs,
    status,
  } = useGame();

  // Let the winning-card ring fade out on its own.
  useEffect(() => {
    if (highlightTrick === null) return undefined;
    const timer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightTrick, clearHighlight]);

  if (view === null) {
    return (
      <main className="table-shell is-loading">
        <p role="status">Repartiendo…</p>
      </main>
    );
  }

  const myTurn = view.turn === view.me && view.winner === null;
  const playable = new Set(
    view.legalActions
      .filter(
        (action): action is Extract<Action, { type: 'playCard' }> => action.type === 'playCard',
      )
      .map((action) => action.card),
  );
  const play = (card: Card) => send({ type: 'playCard', card: cardId(card) });

  return (
    <main className="table-shell">
      <div className="felt" aria-hidden="true" />
      <div className="lamp" aria-hidden="true" />

      <header className="table-top">
        <div className="opponent-zone">
          <OpponentHand count={view.opponentCardCount} thinking={aiThinking} />
          <SpeechBubbles speech={speech} seat="ai" />
        </div>
        <div className="table-top-controls">
          <button
            type="button"
            className="chip-button"
            aria-pressed={prefs.sound}
            onClick={() => setPrefs({ sound: !prefs.sound })}
          >
            Sonido
          </button>
          <button
            type="button"
            className="chip-button"
            aria-pressed={prefs.help}
            onClick={() => setPrefs({ help: !prefs.help })}
          >
            Ayuda
          </button>
          <button type="button" className="chip-button" onClick={() => setScreen('rules')}>
            Reglas
          </button>
        </div>
      </header>

      <section className="table-middle">
        <TrickArea view={view} highlightTrick={highlightTrick} playerName={prefs.playerName} />
        <StakeBanner view={view} />
        {view.lastHandResult !== null && view.phase === 'handOver' && (
          <motion.p
            className="hand-result"
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {handResultText(view.lastHandResult, prefs.playerName)}
          </motion.p>
        )}
      </section>

      <aside className="table-side">
        <Scoreboard view={view} playerName={prefs.playerName} />
        <HandLog view={view} playerName={prefs.playerName} />
      </aside>

      <footer className="table-bottom">
        <SpeechBubbles speech={speech} seat="human" />
        {prefs.help && (
          <HelpPanel
            points={view.myEnvidoPoints}
            strength={view.myHandStrength}
            hasFlor={view.iHaveFlor}
          />
        )}
        <div className="player-hand" role="group" aria-label="Tus cartas">
          <AnimatePresence initial={false} mode="popLayout">
            {view.myHand.map((card, index) => (
              <PlayableCard
                key={cardId(card)}
                card={card}
                index={index}
                tilt={(index - (view.myHand.length - 1) / 2) * 6}
                playable={myTurn && playable.has(cardId(card))}
                onPlay={play}
              />
            ))}
          </AnimatePresence>
        </div>
        <ActionBar view={view} onAction={send} disabled={!myTurn || status !== 'open'} />
      </footer>

      <AnimatePresence>{view.winner !== null && <GameOver />}</AnimatePresence>
    </main>
  );
}

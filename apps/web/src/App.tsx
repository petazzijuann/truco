import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Game } from './screens/Game.js';
import { Home } from './screens/Home.js';
import { Rules } from './screens/Rules.js';
import { primeAudio } from './sound.js';
import { useGame } from './store.js';

/** Transient banner for server errors and connection trouble. */
function Notices() {
  const { notice, dismissNotice, status } = useGame();

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = window.setTimeout(dismissNotice, 3_500);
    return () => window.clearTimeout(timer);
  }, [notice, dismissNotice]);

  const offline = status === 'reconnecting' || status === 'closed';

  return (
    <div className="notices" aria-live="assertive">
      <AnimatePresence>
        {offline && (
          <motion.div
            key="offline"
            className="notice is-warning"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            {status === 'reconnecting' ? 'Reconectando…' : 'Sin conexión con el servidor.'}
          </motion.div>
        )}
        {notice !== null && (
          <motion.div
            key={notice}
            className="notice"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            role="alert"
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function App() {
  const { connect, disconnect, screen } = useGame();

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  // Browsers block audio until the user has interacted, so the context is woken on
  // the first click or key rather than on load.
  useEffect(() => {
    const wake = () => {
      primeAudio();
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  return (
    <>
      <Notices />
      {screen === 'home' && <Home />}
      {screen === 'game' && <Game />}
      {screen === 'rules' && <Rules />}
    </>
  );
}

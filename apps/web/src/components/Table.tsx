import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { PlayerId, PlayerView } from '@truco/shared';
import { cardId } from '@truco/shared';
import { CardBack, CardFace } from '../cards/CardFace.js';
import type { Speech } from '../store.js';
import { ACTION_LABEL, trickOutcomeText } from '../text.js';

/** The AI's hand: face down, so only the count is visible. */
export function OpponentHand({ count, thinking }: { count: number; thinking: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="opponent-hand"
      aria-label={`La máquina tiene ${count} ${count === 1 ? 'carta' : 'cartas'}`}
    >
      <AnimatePresence initial={false}>
        {Array.from({ length: count }, (_, index) => (
          <motion.div
            key={index}
            className="opponent-card"
            layout
            initial={reduceMotion ? false : { y: -120, opacity: 0 }}
            animate={{ y: 0, opacity: 1, rotate: (index - (count - 1) / 2) * 7 }}
            exit={reduceMotion ? { opacity: 0 } : { y: 90, opacity: 0, scale: 0.85 }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 24 }
            }
          >
            <CardBack />
          </motion.div>
        ))}
      </AnimatePresence>
      {thinking && (
        <motion.span
          className="thinking"
          role="status"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          pensando
          <span className="dots" aria-hidden="true" />
        </motion.span>
      )}
    </div>
  );
}

/** Speech bubbles for whatever was just called. */
export function SpeechBubbles({ speech, seat }: { speech: Speech[]; seat: PlayerId }) {
  const reduceMotion = useReducedMotion();
  const mine = speech.filter((bubble) => bubble.player === seat).slice(-1);
  return (
    <div className={`speech-layer is-${seat}`} aria-live="polite">
      <AnimatePresence>
        {mine.map((bubble) => (
          <motion.div
            key={bubble.id}
            className="speech-bubble"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 26 }}
          >
            {bubble.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * The three tricks, side by side, each showing both cards and who took it.
 *
 * Only cards that have actually been played appear here -- the component has no way
 * to render anything else, because the view it is given contains nothing else.
 */
export function TrickArea({
  view,
  highlightTrick,
  playerName,
}: {
  view: PlayerView;
  highlightTrick: number | null;
  playerName: string;
}) {
  const reduceMotion = useReducedMotion();
  const columns = [0, 1, 2];

  return (
    <div className="trick-area" role="group" aria-label="Bazas jugadas">
      {columns.map((index) => {
        const trick = view.tricks[index];
        const active = view.currentTrick === index && view.winner === null;
        const outcome = trick?.outcome ?? null;
        return (
          <div
            key={index}
            className={`trick-column${active ? ' is-active' : ''}`}
            data-testid={`trick-${index}`}
          >
            <span className="trick-label">{index + 1}ª</span>
            <div className="trick-slots">
              <AnimatePresence initial={false}>
                {trick?.plays.map((play) => {
                  const winner = outcome !== 'parda' && outcome === play.player;
                  return (
                    <motion.div
                      key={cardId(play.card)}
                      className={`played-card is-${play.player}`}
                      initial={
                        reduceMotion
                          ? { opacity: 0 }
                          : {
                              opacity: 0,
                              scale: 0.7,
                              y: play.player === 'ai' ? -160 : 180,
                              rotate: play.player === 'ai' ? -12 : 10,
                            }
                      }
                      animate={{
                        opacity: 1,
                        scale: 1,
                        y: 0,
                        rotate: play.player === 'ai' ? -4 : 3,
                      }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 220, damping: 22 }
                      }
                    >
                      <CardFace card={play.card} glow={winner && highlightTrick === index} />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            <span className={`trick-outcome${outcome === null ? ' is-empty' : ''}`}>
              {trickOutcomeText(outcome, playerName)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The running state of the betting, so the stake is never ambiguous. */
export function StakeBanner({ view }: { view: PlayerView }) {
  const chain = view.envido.chain;
  const flor = view.flor.chain;
  return (
    <div className="stake-banner" aria-live="polite">
      <span className="stake-pill" data-tone="truco">
        La mano vale {view.truco.value}
      </span>
      {chain.length > 0 && (
        <span className="stake-pill" data-tone="envido">
          {chain.map((call) => ACTION_LABEL[call]).join(' + ')}
          {view.envido.resolved !== null &&
            ` → ${view.envido.resolved.points} pts (${view.envido.resolved.wanted ? 'querido' : 'no querido'})`}
        </span>
      )}
      {flor.length > 0 && (
        <span className="stake-pill" data-tone="flor">
          {flor.map((call) => ACTION_LABEL[call]).join(' + ')}
          {view.flor.resolved !== null && ` → ${view.flor.resolved.points} pts`}
        </span>
      )}
      {view.truco.parked !== null && (
        <span className="stake-pill" data-tone="parked">
          Queda pendiente: {ACTION_LABEL[view.truco.parked.call]}
        </span>
      )}
    </div>
  );
}

import { motion, useReducedMotion } from 'framer-motion';
import type { PlayerId, PlayerView } from '@truco/shared';
import { playerLabel } from '../text.js';

/**
 * The matchstick scorer, the way it is kept on paper at a table: strokes grouped in
 * fives, each five closed with a diagonal, and the sheet split into "malas" (the
 * first half) and "buenas" (the second).
 */
function MatchGroup({ count, tone }: { count: number; tone: 'malas' | 'buenas' }) {
  // Four uprights plus a diagonal through them makes five.
  const uprights = Math.min(count, 4);
  const crossed = count === 5;
  return (
    <svg viewBox="0 0 34 30" className={`match-group is-${tone}`} aria-hidden="true">
      {Array.from({ length: uprights }, (_, index) => (
        <line key={index} x1={5 + index * 7} y1="4" x2={5 + index * 7} y2="26" />
      ))}
      {crossed && <line x1="2" y1="25" x2="32" y2="5" className="match-cross" />}
    </svg>
  );
}

function groupsOf(points: number): number[] {
  const groups: number[] = [];
  let left = points;
  while (left > 0) {
    groups.push(Math.min(5, left));
    left -= 5;
  }
  return groups;
}

function Half({ points, tone, cap }: { points: number; tone: 'malas' | 'buenas'; cap: number }) {
  const shown = Math.min(points, cap);
  return (
    <div className="score-half" data-tone={tone}>
      <span className="score-half-label">{tone}</span>
      <div className="match-row">
        {groupsOf(shown).map((count, index) => (
          <MatchGroup key={index} count={count} tone={tone} />
        ))}
      </div>
    </div>
  );
}

function SeatScore({
  player,
  view,
  playerName,
}: {
  player: PlayerId;
  view: PlayerView;
  playerName: string;
}) {
  const reduceMotion = useReducedMotion();
  const points = view.scores[player];
  const half = view.config.target / 2;
  const isMano = view.mano === player;

  return (
    <div className="seat-score" data-seat={player}>
      <div className="seat-score-head">
        <span className="seat-name">{playerLabel(player, playerName)}</span>
        {isMano && (
          <span className="mano-badge" title="Es mano en esta repartida">
            mano
          </span>
        )}
        <motion.span
          className="seat-points"
          key={points}
          initial={reduceMotion ? false : { scale: 1.6, color: 'var(--accent)' }}
          animate={{ scale: 1, color: 'var(--ink)' }}
          transition={{ duration: reduceMotion ? 0 : 0.45 }}
          aria-label={`${points} puntos`}
        >
          {points}
        </motion.span>
      </div>
      <Half points={points} tone="malas" cap={half} />
      <Half points={Math.max(0, points - half)} tone="buenas" cap={half} />
    </div>
  );
}

export function Scoreboard({ view, playerName }: { view: PlayerView; playerName: string }) {
  return (
    <section
      className="scoreboard"
      aria-label={`Anotador: ${playerName} ${view.scores.human}, la máquina ${view.scores.ai}, a ${view.config.target} puntos`}
    >
      <header className="scoreboard-head">
        <h2>Anotador</h2>
        <span className="scoreboard-target">a {view.config.target}</span>
      </header>
      <SeatScore player="human" view={view} playerName={playerName} />
      <div className="scoreboard-divider" />
      <SeatScore player="ai" view={view} playerName={playerName} />
      <p className="scoreboard-hand">Mano #{view.handNumber}</p>
    </section>
  );
}

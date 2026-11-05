import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Action, PlayerView } from '@truco/shared';
import { actionKey } from '@truco/shared';
import { ACTION_LABEL, ACTION_SHORTCUT, ACTION_TONE } from '../text.js';

export type ActionBarProps = {
  view: PlayerView;
  onAction: (action: Action) => void;
  disabled: boolean;
};

const TONE_ORDER = ['accept', 'bet', 'refuse', 'neutral'] as const;

/**
 * The call buttons.
 *
 * Crucially, this renders `view.legalActions` and nothing else. There is no table of
 * rules in the client deciding what to show: if the server did not offer a move, no
 * button for it exists. That is what keeps the UI and the engine from drifting apart.
 */
export function ActionBar({ view, onAction, disabled }: ActionBarProps) {
  const reduceMotion = useReducedMotion();

  // Playing a card happens by clicking the card itself, not from this bar.
  const calls = useMemo(
    () =>
      view.legalActions
        .filter((action) => action.type !== 'playCard')
        .sort(
          (a, b) =>
            TONE_ORDER.indexOf(ACTION_TONE[a.type]) - TONE_ORDER.indexOf(ACTION_TONE[b.type]),
        ),
    [view.legalActions],
  );

  // Keyboard shortcuts, bound only to moves that are actually legal right now.
  useEffect(() => {
    if (disabled) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const pressed = event.key.toLowerCase();
      const match = calls.find((action) => ACTION_SHORTCUT[action.type] === pressed);
      if (match === undefined) return;
      event.preventDefault();
      onAction(match);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calls, disabled, onAction]);

  return (
    <div className="action-bar" role="group" aria-label="Cantos disponibles">
      <AnimatePresence initial={false} mode="popLayout">
        {calls.map((action) => {
          const shortcut = ACTION_SHORTCUT[action.type];
          return (
            <motion.button
              key={actionKey(action)}
              type="button"
              className="action-button"
              data-tone={ACTION_TONE[action.type]}
              data-testid={`action-${action.type}`}
              onClick={() => onAction(action)}
              disabled={disabled}
              layout
              initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <span>{ACTION_LABEL[action.type]}</span>
              {shortcut !== undefined && shortcut !== ' ' && (
                <kbd aria-hidden="true">{shortcut.toUpperCase()}</kbd>
              )}
            </motion.button>
          );
        })}
      </AnimatePresence>
      {calls.length === 0 && (
        <p className="action-bar-empty">
          {view.turn === view.me ? 'Tirá una carta.' : 'Esperá el turno…'}
        </p>
      )}
    </div>
  );
}

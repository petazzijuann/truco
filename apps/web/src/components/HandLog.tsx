import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { GameEvent, PlayerView } from '@truco/shared';
import { cardFromId } from '@truco/shared';
import { ACTION_LABEL, cardAria, playerLabel } from '../text.js';

/** One log line, in plain Spanish. */
function describe(event: GameEvent, playerName: string): string | null {
  const who = (player: Parameters<typeof playerLabel>[0]) => playerLabel(player, playerName);
  switch (event.type) {
    case 'handDealt':
      return `Se reparte la mano ${event.handNumber}. Es mano ${who(event.mano)}.`;
    case 'cardPlayed': {
      const card = cardFromId(event.card);
      return `${who(event.player)} tira ${card === undefined ? event.card : cardAria(card)}.`;
    }
    case 'trickResolved':
      return event.outcome === 'parda'
        ? `La ${event.trick + 1}ª baza es parda.`
        : `${who(event.outcome)} gana la ${event.trick + 1}ª baza.`;
    case 'called':
      return `${who(event.player)}: ${ACTION_LABEL[event.call]}`;
    case 'responded':
      return `${who(event.player)}: ${event.response === 'quiero' ? 'quiero' : 'no quiero'}.`;
    case 'pointsDeclared':
      return `${who(event.player)} canta ${event.points}.`;
    case 'sonBuenas':
      return `${who(event.player)}: son buenas.`;
    case 'envidoResolved':
      return `Envido para ${who(event.winner)}: ${event.points} ${event.points === 1 ? 'punto' : 'puntos'}.`;
    case 'florResolved':
      return `Flor para ${who(event.winner)}: ${event.points} ${event.points === 1 ? 'punto' : 'puntos'}.`;
    case 'cardsRevealed': {
      const cards = event.cards
        .map((id) => cardFromId(id))
        .filter((card): card is NonNullable<typeof card> => card !== undefined)
        .map(cardAria)
        .join(', ');
      return `${who(event.player)} muestra ${cards}.`;
    }
    case 'wentToDeck':
      return `${who(event.player)} se va al mazo.`;
    case 'handEnded':
      return `Fin de la mano: ${event.points} para ${who(event.winner)}.`;
    case 'gameEnded':
      return `¡Partida para ${who(event.winner)}!`;
    case 'scoreChanged':
      return null;
  }
}

export function HandLog({ view, playerName }: { view: PlayerView; playerName: string }) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const lines = view.log
    .map((event) => ({ seq: event.seq, text: describe(event, playerName) }))
    .filter((line): line is { seq: number; text: string } => line.text !== null);

  return (
    <section className={`hand-log${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="hand-log-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="hand-log-body"
      >
        Historial de la mano
        <span className="chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            id="hand-log-body"
            className="hand-log-body"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
          >
            {lines.length === 0 && <li className="is-empty">Todavía no pasó nada.</li>}
            {lines.map((line) => (
              <li key={line.seq}>{line.text}</li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </section>
  );
}

import { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Card } from '@truco/shared';
import { cardId } from '@truco/shared';
import { CardFace } from './CardFace.js';
import { cardAria } from '../text.js';

export type PlayableCardProps = {
  card: Card;
  playable: boolean;
  onPlay: (card: Card) => void;
  /** Fan offset, in degrees. */
  tilt?: number;
  index: number;
};

/** Dragging this far up counts as playing the card. */
const DRAG_THRESHOLD = -70;

/**
 * A card in your own hand: clickable, draggable towards the table, and reachable by
 * keyboard. Dragging and clicking do the same thing, so nothing is only available to
 * a mouse.
 */
export function PlayableCard({ card, playable, onPlay, tilt = 0, index }: PlayableCardProps) {
  const reduceMotion = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const liftRef = useRef(false);

  const play = () => {
    if (playable) onPlay(card);
  };

  return (
    <motion.button
      type="button"
      className={`playable-card${playable ? '' : ' is-locked'}${dragging ? ' is-dragging' : ''}`}
      aria-label={`${cardAria(card)}${playable ? '' : ' (no se puede jugar ahora)'}`}
      aria-disabled={!playable}
      data-testid={`hand-card-${cardId(card)}`}
      onClick={play}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          play();
        }
      }}
      layout
      initial={reduceMotion ? false : { y: 140, opacity: 0, rotate: 0 }}
      animate={{ y: 0, opacity: 1, rotate: tilt }}
      exit={reduceMotion ? { opacity: 0 } : { y: -180, opacity: 0, scale: 0.85 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: 'spring', stiffness: 260, damping: 24, delay: index * 0.08 }
      }
      {...(playable && !reduceMotion ? { whileHover: { y: -18, scale: 1.04, zIndex: 5 } } : {})}
      {...(playable
        ? { whileFocus: { y: -18, scale: 1.04, zIndex: 5 }, whileTap: { scale: 0.98 } }
        : {})}
      drag={playable ? 'y' : false}
      dragConstraints={{ top: -160, bottom: 10 }}
      dragElastic={0.18}
      dragSnapToOrigin
      onDragStart={() => {
        setDragging(true);
        liftRef.current = false;
      }}
      onDrag={(_event, info) => {
        liftRef.current = info.offset.y < DRAG_THRESHOLD;
      }}
      onDragEnd={() => {
        setDragging(false);
        if (liftRef.current) play();
      }}
    >
      <CardFace card={card} muted={!playable} />
    </motion.button>
  );
}

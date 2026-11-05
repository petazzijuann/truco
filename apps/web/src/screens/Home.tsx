import { useState } from 'react';
import { motion } from 'framer-motion';
import { DIFFICULTIES, type Difficulty, type GameConfigPatch } from '@truco/shared';
import { DIFFICULTY_BLURB, DIFFICULTY_LABEL } from '../text.js';
import { SuitIcon } from '../cards/suits.js';
import { useGame } from '../store.js';

export function Home() {
  const { prefs, setPrefs, newGame, setScreen, status } = useGame();
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [target, setTarget] = useState<15 | 30>(30);
  const [flor, setFlor] = useState(false);
  const [name, setName] = useState(prefs.playerName);

  const start = () => {
    const trimmed = name.trim().slice(0, 24) || 'Vos';
    setPrefs({ playerName: trimmed });
    const config: GameConfigPatch = { difficulty, target, flor, playerName: trimmed };
    newGame(config);
  };

  return (
    <motion.main
      className="home"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <header className="home-head">
        <div className="home-suits" aria-hidden="true">
          <SuitIcon suit="espada" size={30} />
          <SuitIcon suit="basto" size={30} />
          <SuitIcon suit="oro" size={30} />
          <SuitIcon suit="copa" size={30} />
        </div>
        <h1>Truco</h1>
        <p className="home-tagline">
          Mano a mano contra la máquina. Y sin mirar las cartas de nadie.
        </p>
      </header>

      <form
        className="home-form"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <label className="field">
          <span>Tu nombre</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
            placeholder="Vos"
            autoComplete="off"
          />
        </label>

        <fieldset className="field">
          <legend>Dificultad</legend>
          <div className="choice-row">
            {DIFFICULTIES.map((option) => (
              <button
                key={option}
                type="button"
                className="choice"
                aria-pressed={difficulty === option}
                onClick={() => setDifficulty(option)}
              >
                {DIFFICULTY_LABEL[option]}
              </button>
            ))}
          </div>
          <p className="field-hint">{DIFFICULTY_BLURB[difficulty]}</p>
        </fieldset>

        <fieldset className="field">
          <legend>Puntos</legend>
          <div className="choice-row">
            {([30, 15] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="choice"
                aria-pressed={target === option}
                onClick={() => setTarget(option)}
              >
                a {option}
              </button>
            ))}
          </div>
          <p className="field-hint">
            {target === 30
              ? '15 malas y 15 buenas, como siempre.'
              : 'Partida corta, todo a las malas.'}
          </p>
        </fieldset>

        <div className="toggle-row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={flor}
              onChange={(event) => setFlor(event.target.checked)}
            />
            <span>Con flor</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={prefs.sound}
              onChange={(event) => setPrefs({ sound: event.target.checked })}
            />
            <span>Sonido</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={prefs.help}
              onChange={(event) => setPrefs({ help: event.target.checked })}
            />
            <span>Modo ayuda</span>
          </label>
        </div>
        <p className="field-hint">
          El modo ayuda te muestra tus puntos de envido y la fuerza de <em>tu</em> mano. Nunca
          información del rival.
        </p>

        <div className="home-actions">
          <button type="submit" className="primary" disabled={status !== 'open'}>
            {status === 'open' ? 'Jugar' : 'Conectando…'}
          </button>
          <button type="button" className="ghost" onClick={() => setScreen('rules')}>
            Reglas
          </button>
        </div>
      </form>
    </motion.main>
  );
}

import { motion } from 'framer-motion';
import type { Card } from '@truco/shared';
import { CardFace } from '../cards/CardFace.js';
import { useGame } from '../store.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

/** The hierarchy, strongest first. Each row is one tier: cards in a tier tie. */
const TIERS: { cards: Card[]; note: string }[] = [
  { cards: [c(1, 'espada')], note: 'ancho de espada' },
  { cards: [c(1, 'basto')], note: 'ancho de basto' },
  { cards: [c(7, 'espada')], note: '' },
  { cards: [c(7, 'oro')], note: '' },
  { cards: [c(3, 'espada'), c(3, 'basto'), c(3, 'oro'), c(3, 'copa')], note: 'los cuatro empatan' },
  { cards: [c(2, 'espada'), c(2, 'basto'), c(2, 'oro'), c(2, 'copa')], note: 'los cuatro empatan' },
  { cards: [c(1, 'copa'), c(1, 'oro')], note: 'anchos falsos' },
  { cards: [c(12, 'espada'), c(12, 'basto'), c(12, 'oro'), c(12, 'copa')], note: '' },
  { cards: [c(11, 'espada'), c(11, 'basto'), c(11, 'oro'), c(11, 'copa')], note: '' },
  { cards: [c(10, 'espada'), c(10, 'basto'), c(10, 'oro'), c(10, 'copa')], note: '' },
  { cards: [c(7, 'copa'), c(7, 'basto')], note: 'los sietes flojos' },
  { cards: [c(6, 'espada'), c(6, 'basto'), c(6, 'oro'), c(6, 'copa')], note: '' },
  { cards: [c(5, 'espada'), c(5, 'basto'), c(5, 'oro'), c(5, 'copa')], note: '' },
  { cards: [c(4, 'espada'), c(4, 'basto'), c(4, 'oro'), c(4, 'copa')], note: 'las más bajas' },
];

const ENVIDO_TABLE: [string, string, string][] = [
  ['Envido', '2', '1'],
  ['Envido + envido', '4', '2'],
  ['Real envido', '3', '1'],
  ['Envido + real envido', '5', '2'],
  ['Envido + envido + real envido', '7', '4'],
  ['Falta envido', 'ver abajo', 'lo acumulado, o 1'],
  ['Cualquier secuencia + falta envido', 'la falta', 'lo que valía la secuencia'],
];

const TRUCO_TABLE: [string, string, string][] = [
  ['Nada cantado', '1', '—'],
  ['Truco', '2', '1'],
  ['Retruco', '3', '2'],
  ['Vale cuatro', '4', '3'],
];

export function Rules() {
  const { setScreen, view } = useGame();

  return (
    <motion.main
      className="rules"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <header className="rules-head">
        <h1>Reglas</h1>
        <button
          type="button"
          className="ghost"
          onClick={() => setScreen(view === null ? 'home' : 'game')}
        >
          Volver
        </button>
      </header>

      <section>
        <h2>El mazo</h2>
        <p>
          Baraja española de 40 cartas: espada, basto, oro y copa, con valores 1 a 7, 10, 11 y 12.
          No hay 8 ni 9.
        </p>
      </section>

      <section>
        <h2>Jerarquía para el truco</h2>
        <p>
          De mayor a menor. Las cartas de una misma fila valen lo mismo: si se enfrentan, la baza es{' '}
          <strong>parda</strong>.
        </p>
        <ol className="hierarchy">
          {TIERS.map((tier, index) => (
            <li key={index}>
              <span className="hierarchy-rank">{index + 1}</span>
              <span className="hierarchy-cards">
                {tier.cards.map((card) => (
                  <span className="hierarchy-card" key={`${card.rank}-${card.suit}`}>
                    <CardFace card={card} />
                  </span>
                ))}
              </span>
              {tier.note !== '' && <span className="hierarchy-note">{tier.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>Las tres bazas y las pardas</h2>
        <ul>
          <li>Gana la mano quien gane 2 de 3 bazas.</li>
          <li>
            El ganador de una baza empieza la siguiente. Si fue parda, empieza quien era mano.
          </li>
          <li>
            Parda la 1ª: gana quien gane la 2ª. Si también es parda, la 3ª. Si las tres son pardas,
            gana el mano.
          </li>
          <li>Gana la 1ª uno y la 2ª es parda: gana quien ganó la 1ª.</li>
          <li>Una baza cada uno y la 3ª parda: gana quien ganó la 1ª.</li>
          <li>
            La mano termina en cuanto el resultado está decidido: no se juega la 3ª si no hace
            falta.
          </li>
        </ul>
      </section>

      <section>
        <h2>Truco</h2>
        <table className="rules-table">
          <thead>
            <tr>
              <th scope="col">Canto</th>
              <th scope="col">Querido</th>
              <th scope="col">No querido</th>
            </tr>
          </thead>
          <tbody>
            {TRUCO_TABLE.map(([name, yes, no]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{yes}</td>
                <td>{no}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Solo puede subir la apuesta quien aceptó el último canto: tiene <em>la palabra</em>. Nadie
          canta dos veces seguidas, y se canta en tu turno, antes de tirar la carta.
        </p>
      </section>

      <section>
        <h2>Envido</h2>
        <p>
          Se canta solo en la primera baza, antes de que el que canta haya tirado su carta.
          <strong> El envido está primero</strong>: si te cantan truco y todavía no tiraste, podés
          contestar con envido; se resuelve el envido y después se vuelve al truco.
        </p>
        <p>
          <strong>Cuenta:</strong> con dos o tres cartas del mismo palo, se suman las dos más altas
          de ese palo más 20. Las figuras (10, 11 y 12) valen 0. Máximo 33. Sin dos del mismo palo,
          vale la carta más alta.
        </p>
        <table className="rules-table">
          <thead>
            <tr>
              <th scope="col">Secuencia</th>
              <th scope="col">Querido</th>
              <th scope="col">No querido</th>
            </tr>
          </thead>
          <tbody>
            {ENVIDO_TABLE.map(([name, yes, no]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{yes}</td>
                <td>{no}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>Falta envido:</strong> si el que va ganando está en las malas, el que gana el
          envido se lleva la partida. Si está en las buenas, vale los puntos que le faltan al que va
          ganando para llegar al objetivo.
        </p>
        <p>
          Primero canta sus puntos el mano; el otro dice los suyos o <em>son buenas</em>. Si
          empatan, gana el mano. Al final de la mano, el ganador del envido muestra las cartas que
          lo justifican: las que no participaron quedan tapadas.
        </p>
      </section>

      <section>
        <h2>Flor (opcional)</h2>
        <p>
          Tres cartas del mismo palo. Vale 3 y hay que cantarla en la primera baza, antes de tirar.
          Anula el envido de esa mano. Si los dos tienen flor, se puede subir a{' '}
          <strong>contraflor</strong> (6) o <strong>contraflor al resto</strong> (la falta); quien
          no quiera pelearla dice <em>con flor me achico</em> y paga lo que valía la secuencia
          anterior. Gana la flor más alta; si empatan, el mano.
        </p>
      </section>

      <section>
        <h2>Irse al mazo</h2>
        <p>
          Podés irte al mazo en tu turno: el rival se lleva el valor actual del truco. Si te vas en
          la primera baza y todavía no se jugó el envido, suma 1 punto extra.
        </p>
      </section>

      <section>
        <h2>La partida</h2>
        <p>
          A 30 puntos: 15 malas y 15 buenas. También se puede jugar a 15. Si alguien llega al
          objetivo en medio de una mano (por envido o flor), la partida termina ahí mismo.
        </p>
      </section>

      <section>
        <h2>Atajos de teclado</h2>
        <ul className="shortcut-list">
          <li>
            <kbd>T</kbd> truco
          </li>
          <li>
            <kbd>R</kbd> retruco
          </li>
          <li>
            <kbd>V</kbd> vale cuatro
          </li>
          <li>
            <kbd>E</kbd> envido
          </li>
          <li>
            <kbd>D</kbd> real envido
          </li>
          <li>
            <kbd>F</kbd> falta envido
          </li>
          <li>
            <kbd>L</kbd> flor
          </li>
          <li>
            <kbd>Q</kbd> quiero
          </li>
          <li>
            <kbd>N</kbd> no quiero
          </li>
          <li>
            <kbd>P</kbd> cantar puntos
          </li>
          <li>
            <kbd>B</kbd> son buenas
          </li>
          <li>
            <kbd>M</kbd> irse al mazo
          </li>
        </ul>
      </section>
    </motion.main>
  );
}

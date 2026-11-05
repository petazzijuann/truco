import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HandLog } from './HandLog.js';
import { Scoreboard } from './Scoreboard.js';
import { OpponentHand, StakeBanner, TrickArea } from './Table.js';
import { c, makeView } from '../test-fixtures.js';

describe('OpponentHand', () => {
  it('shows backs only, and announces the count', () => {
    render(<OpponentHand count={2} thinking={false} />);
    const zone = screen.getByLabelText('La máquina tiene 2 cartas');
    expect(within(zone).getAllByLabelText('Carta boca abajo')).toHaveLength(2);
    // There is no way for a face to appear here: the component renders only backs.
    expect(within(zone).queryByLabelText(/de espada/)).not.toBeInTheDocument();
  });

  it('says when the ai is thinking', () => {
    render(<OpponentHand count={3} thinking />);
    expect(screen.getByRole('status')).toHaveTextContent('pensando');
  });
});

describe('TrickArea', () => {
  it('renders three columns and only the cards that were played', () => {
    const view = makeView({
      tricks: [
        {
          plays: [
            { player: 'human', card: c(1, 'espada') },
            { player: 'ai', card: c(4, 'copa') },
          ],
          outcome: 'human',
        },
        { plays: [{ player: 'human', card: c(7, 'oro') }], outcome: null },
      ],
      currentTrick: 1,
    });
    render(<TrickArea view={view} highlightTrick={0} playerName="Juan" />);

    const first = screen.getByTestId('trick-0');
    expect(within(first).getByLabelText('1 de espada')).toBeInTheDocument();
    expect(within(first).getByLabelText('4 de copa')).toBeInTheDocument();
    expect(within(first)).toBeDefined();
    expect(first).toHaveTextContent('Juan');

    const third = screen.getByTestId('trick-2');
    expect(within(third).queryByRole('img')).not.toBeInTheDocument();
  });

  it('labels a tied trick as parda', () => {
    const view = makeView({
      tricks: [
        {
          plays: [
            { player: 'human', card: c(3, 'oro') },
            { player: 'ai', card: c(3, 'copa') },
          ],
          outcome: 'parda',
        },
      ],
    });
    render(<TrickArea view={view} highlightTrick={null} playerName="Juan" />);
    expect(screen.getByTestId('trick-0')).toHaveTextContent('Parda');
  });
});

describe('StakeBanner', () => {
  it('always states what the hand is worth', () => {
    render(<StakeBanner view={makeView()} />);
    expect(screen.getByText('La mano vale 1')).toBeInTheDocument();
  });

  it('spells out the envido chain in words, not enum names', () => {
    const view = makeView({
      envido: {
        chain: ['envido', 'realEnvido'],
        pending: null,
        declarations: [],
        resolved: { winner: 'human', points: 5, wanted: true },
        stillAvailable: false,
      },
    });
    render(<StakeBanner view={view} />);
    expect(screen.getByText(/Envido \+ Real envido/)).toBeInTheDocument();
    expect(screen.queryByText(/realEnvido/)).not.toBeInTheDocument();
  });

  it('flags a truco parked behind the envido', () => {
    const view = makeView({
      truco: {
        level: 0,
        value: 1,
        pending: null,
        wordHolder: null,
        parked: { by: 'ai', call: 'truco' },
      },
    });
    render(<StakeBanner view={view} />);
    expect(screen.getByText(/Queda pendiente/)).toHaveTextContent('¡Truco!');
  });
});

describe('Scoreboard', () => {
  it('summarises the score for a screen reader', () => {
    const view = makeView({ scores: { human: 7, ai: 18 } });
    render(<Scoreboard view={view} playerName="Juan" />);
    expect(
      screen.getByLabelText('Anotador: Juan 7, la máquina 18, a 30 puntos'),
    ).toBeInTheDocument();
  });

  it('marks who is mano', () => {
    const view = makeView({ mano: 'ai' });
    render(<Scoreboard view={view} playerName="Juan" />);
    expect(screen.getByTitle('Es mano en esta repartida')).toBeInTheDocument();
  });

  it('splits the score into malas and buenas', () => {
    const view = makeView({ scores: { human: 18, ai: 0 } });
    const { container } = render(<Scoreboard view={view} playerName="Juan" />);
    const seat = container.querySelector('[data-seat="human"]')!;
    // 15 in the malas is three closed groups of five; the remaining 3 go to the buenas.
    expect(seat.querySelectorAll('.match-group.is-malas')).toHaveLength(3);
    expect(seat.querySelectorAll('.match-group.is-buenas')).toHaveLength(1);
  });
});

describe('HandLog', () => {
  it('starts collapsed and expands on demand', async () => {
    const view = makeView({
      log: [
        { seq: 1, type: 'handDealt', handNumber: 1, mano: 'human' },
        { seq: 2, type: 'called', player: 'ai', call: 'truco' },
        { seq: 3, type: 'cardPlayed', player: 'human', card: '1-espada', trick: 0 },
        { seq: 4, type: 'scoreChanged', scores: { human: 1, ai: 0 } },
      ],
    });
    render(<HandLog view={view} playerName="Juan" />);

    const toggle = screen.getByRole('button', { name: /Historial/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.click();

    expect(await screen.findByText(/Se reparte la mano 1/)).toBeInTheDocument();
    expect(screen.getByText('La máquina: ¡Truco!')).toBeInTheDocument();
    expect(screen.getByText('Juan tira 1 de espada.')).toBeInTheDocument();
    // A score change has no sentence of its own; the anotador shows it.
    expect(screen.queryByText(/scoreChanged/)).not.toBeInTheDocument();
  });
});

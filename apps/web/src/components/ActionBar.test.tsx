import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Action, PlayerView } from '@truco/shared';
import { ActionBar } from './ActionBar.js';
import { makeView } from '../test-fixtures.js';

const renderBar = (legalActions: Action[], overrides: Partial<PlayerView> = {}) => {
  const onAction = vi.fn();
  const view = makeView({ legalActions, ...overrides });
  render(<ActionBar view={view} onAction={onAction} disabled={false} />);
  return { onAction };
};

describe('ActionBar', () => {
  it('renders exactly the calls the server offered, and nothing else', () => {
    renderBar([{ type: 'truco' }, { type: 'envido' }, { type: 'irseAlMazo' }]);

    expect(screen.getByRole('button', { name: /¡Truco!/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Envido/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Me voy al mazo/ })).toBeInTheDocument();
    // Never invents a call the server did not offer.
    expect(screen.queryByRole('button', { name: /Quiero/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vale cuatro/ })).not.toBeInTheDocument();
  });

  it('leaves card play to the cards themselves', () => {
    renderBar([{ type: 'playCard', card: '1-espada' }, { type: 'truco' }]);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('sends the exact action object it was given', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar([{ type: 'realEnvido' }]);
    await user.click(screen.getByRole('button', { name: /Real envido/ }));
    expect(onAction).toHaveBeenCalledWith({ type: 'realEnvido' });
  });

  it('binds a keyboard shortcut to each legal call', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar([{ type: 'quiero' }, { type: 'noQuiero' }]);
    await user.keyboard('q');
    expect(onAction).toHaveBeenCalledWith({ type: 'quiero' });
    await user.keyboard('n');
    expect(onAction).toHaveBeenCalledWith({ type: 'noQuiero' });
  });

  it('does not fire a shortcut for a call that is not legal', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar([{ type: 'quiero' }]);
    await user.keyboard('t');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('prompts to play a card when there is nothing to call', () => {
    renderBar([{ type: 'playCard', card: '1-espada' }], { turn: 'human' });
    expect(screen.getByText('Tirá una carta.')).toBeInTheDocument();
  });

  it('says to wait when it is not your turn', () => {
    renderBar([], { turn: 'ai' });
    expect(screen.getByText('Esperá el turno…')).toBeInTheDocument();
  });

  it('disables every button while the ai is playing', () => {
    const view = makeView({ legalActions: [{ type: 'truco' }] });
    render(<ActionBar view={view} onAction={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /¡Truco!/ })).toBeDisabled();
  });
});

import { describe, expect, it } from 'vitest';
import { cardId, defaultConfig, seededRng, type PlayerId } from '@truco/shared';
import { applyAction } from './apply.js';
import { getLegalActions } from './legal.js';
import { getPlayerView } from './playerView.js';
import { buildState } from './scenario.js';
import { createGame, type GameState } from './state.js';
import { c, playOf, run } from './helpers.test-utils.js';

const HIGH = [c(7, 'oro'), c(6, 'oro'), c(4, 'copa')];
const LOW = [c(5, 'espada'), c(2, 'espada'), c(12, 'basto')];
const fresh = () => buildState({ human: HIGH, ai: LOW, mano: 'human' });

/** Every card id that appears anywhere in the serialised view. */
const idsInView = (state: GameState, me: PlayerId): Set<string> => {
  const json = JSON.stringify(getPlayerView(state, me));
  const found = new Set<string>();
  for (const match of json.matchAll(/"rank":(\d+),"suit":"(\w+)"/g)) {
    found.add(`${match[1]}-${match[2]}`);
  }
  for (const match of json.matchAll(/"(\d+-(?:espada|basto|oro|copa))"/g)) {
    found.add(match[1]!);
  }
  return found;
};

/** Opponent cards that are legitimately public: played face-up, or deliberately shown. */
const publicOpponentIds = (state: GameState, me: PlayerId): Set<string> => {
  const opponent = me === 'human' ? 'ai' : 'human';
  const ids = new Set<string>();
  for (const trick of state.tricks) {
    for (const play of trick.plays) {
      if (play.player === opponent) ids.add(cardId(play.card));
    }
  }
  for (const card of state.revealed[opponent]) ids.add(cardId(card));
  return ids;
};

/** The leak check: no hidden opponent card may appear anywhere in the view. */
function assertNoLeak(state: GameState, me: PlayerId): void {
  const opponent = me === 'human' ? 'ai' : 'human';
  const allowed = publicOpponentIds(state, me);
  const hidden = state.dealt[opponent].map(cardId).filter((id) => !allowed.has(id));
  const present = idsInView(state, me);
  for (const id of hidden) {
    expect(present.has(id), `view for ${me} leaked the hidden card ${id}`).toBe(false);
  }
}

describe('getPlayerView', () => {
  it('shows my own cards and only the count of the opponent', () => {
    const view = getPlayerView(fresh(), 'human');
    expect(view.myHand.map(cardId).sort()).toEqual(['4-copa', '6-oro', '7-oro']);
    expect(view.opponentCardCount).toBe(3);
    expect(view.knownOpponentCards).toEqual([]);
  });

  it('never includes an unplayed opponent card', () => {
    assertNoLeak(fresh(), 'human');
    assertNoLeak(fresh(), 'ai');
  });

  it('exposes an opponent card only once it has been played', () => {
    const state = run(fresh(), [['human', playOf(c(7, 'oro'))]]);
    const aiView = getPlayerView(state, 'ai');
    expect(aiView.knownOpponentCards.map(cardId)).toEqual(['7-oro']);
    assertNoLeak(state, 'ai');
    assertNoLeak(state, 'human');
  });

  it('exposes the envido winner cards after the reveal, and nothing more', () => {
    let state = run(fresh(), [
      ['human', { type: 'envido' }],
      ['ai', { type: 'quiero' }],
      ['human', { type: 'declarePoints' }],
      ['ai', { type: 'sonBuenas' }],
    ]);
    // Mid-hand, nothing is revealed yet.
    expect(getPlayerView(state, 'ai').knownOpponentCards).toEqual([]);

    state = run(state, [['human', { type: 'irseAlMazo' }]]);
    const aiView = getPlayerView(state, 'ai');
    // The 7 and 6 of oro justify the 33; the 4 of copa is still a secret.
    expect(aiView.knownOpponentCards.map(cardId).sort()).toEqual(['6-oro', '7-oro']);
    expect(idsInView(state, 'ai').has('4-copa')).toBe(false);
    assertNoLeak(state, 'ai');
  });

  it('reports my own envido count but never the opponent count', () => {
    const state = fresh();
    expect(getPlayerView(state, 'human').myEnvidoPoints).toBe(33);
    expect(getPlayerView(state, 'ai').myEnvidoPoints).toBe(27);
    // The declared counts only appear once they are actually said out loud.
    expect(getPlayerView(state, 'ai').envido.declarations).toEqual([]);
  });

  it('offers legal actions only to the seat on turn', () => {
    const state = fresh();
    expect(getPlayerView(state, 'human').legalActions.length).toBeGreaterThan(0);
    expect(getPlayerView(state, 'ai').legalActions).toEqual([]);
  });

  it('is a deep copy: mutating the view cannot corrupt the game', () => {
    const state = fresh();
    const view = getPlayerView(state, 'human');
    view.myHand.pop();
    (view.myHand[0] as { rank: number }).rank = 1;
    view.scores.human = 99;
    view.log.push({ seq: 99, type: 'wentToDeck', player: 'ai' });
    expect(state.hands.human).toHaveLength(3);
    expect(state.hands.human[0]!.rank).toBe(7);
    expect(state.scores.human).toBe(0);
    expect(state.log).toHaveLength(0);
  });

  it('marks the hand as finished once it is over', () => {
    const state = run(fresh(), [['human', { type: 'irseAlMazo' }]]);
    const view = getPlayerView(state, 'human');
    expect(view.currentTrick).toBe(3);
    expect(view.phase).toBe('handOver');
    expect(view.lastHandResult).toEqual({ winner: 'ai', points: 2, reason: 'mazo' });
  });

  it('keeps both seats blind through an entire randomly played game', () => {
    const rng = seededRng(77);
    let state = createGame(defaultConfig(), rng);
    let guard = 0;
    while (state.winner === null) {
      if (guard++ > 5_000) throw new Error('game did not terminate');
      assertNoLeak(state, 'human');
      assertNoLeak(state, 'ai');
      const player = state.phase === 'handOver' ? state.mano : state.turn;
      const actions = getLegalActions(state, player);
      const action = actions[rng.int(actions.length)]!;
      state = applyAction(state, player, action, rng);
    }
    assertNoLeak(state, 'human');
    assertNoLeak(state, 'ai');
  });
});

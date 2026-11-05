import { expect, test, type Page, type WebSocket } from '@playwright/test';

/**
 * Every frame the server sent, captured straight off the socket. The leak test reads
 * these rather than the DOM, so it checks what actually crossed the wire.
 */
type Captured = { frames: string[] };

function captureSocket(page: Page): Captured {
  const captured: Captured = { frames: [] };
  page.on('websocket', (socket: WebSocket) => {
    socket.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') captured.frames.push(frame.payload);
    });
  });
  return captured;
}

/** Start a game from the home screen and wait for the table. */
async function startGame(page: Page, options: { difficulty?: string } = {}): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).waitFor();
  if (options.difficulty !== undefined) {
    await page.getByRole('button', { name: options.difficulty, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.getByRole('group', { name: 'Tus cartas' })).toBeVisible();
}

/** The buttons the server is currently offering. */
async function offeredCalls(page: Page): Promise<string[]> {
  const bar = page.getByRole('group', { name: 'Cantos disponibles' });
  return bar.getByRole('button').allInnerTexts();
}

/** The end-of-game dialog covers the table, so nothing is clickable behind it. */
const gameIsOver = (page: Page): Promise<boolean> =>
  page
    .getByRole('dialog')
    .isVisible()
    .catch(() => false);

/**
 * Take whatever turn is available.
 *
 * Answers come first (a pending call has to be settled before anything else can
 * happen), then a card, then whatever else the bar is offering. Without the
 * `declarePoints` branch the driver deadlocks whenever an envido is accepted: no
 * card is playable in that phase, and nothing else is on offer.
 */
async function takeTurn(page: Page): Promise<boolean> {
  if (await gameIsOver(page)) return false;

  for (const testId of ['action-quiero', 'action-declarePoints', 'action-nextHand']) {
    const button = page.getByTestId(testId);
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      return true;
    }
  }

  const cards = page.getByRole('group', { name: 'Tus cartas' }).getByRole('button');
  const count = await cards.count();
  for (let index = 0; index < count; index++) {
    const card = cards.nth(index);
    if ((await card.getAttribute('aria-disabled')) === 'true') continue;
    await card.click({ timeout: 5_000 }).catch(() => undefined);
    return true;
  }

  // Anything else the server is offering (a response to a flor, for instance).
  const bar = page.getByRole('group', { name: 'Cantos disponibles' }).getByRole('button');
  if ((await bar.count()) > 0) {
    await bar
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    return true;
  }
  return false;
}

/** Play the human's side for a while, stopping early once the game is decided. */
async function playFor(page: Page, steps: number): Promise<void> {
  for (let step = 0; step < steps; step++) {
    if (await gameIsOver(page)) return;
    if (!(await takeTurn(page))) await page.waitForTimeout(300);
  }
}

test.describe('una mano completa', () => {
  test('reparte, permite cantar y juega la mano hasta anotar', async ({ page }) => {
    await startGame(page, { difficulty: 'Fácil' });

    // Three cards, face up, each one named for a screen reader.
    const hand = page.getByRole('group', { name: 'Tus cartas' });
    await expect(hand.getByRole('button')).toHaveCount(3);
    await expect(hand.getByRole('button').first()).toHaveAccessibleName(
      /\d+ de (espada|basto|oro|copa)/,
    );

    // The opponent's hand is face down and only its size is visible.
    await expect(page.getByLabel(/La máquina tiene 3 cartas/)).toBeVisible();

    // The hand starts worth 1 and the anotador is at zero.
    await expect(page.getByText('La mano vale 1')).toBeVisible();
    await expect(page.getByLabel(/Anotador: .*0, la máquina 0/)).toBeVisible();

    // Play on until the first points land. A falta envido can take the whole game in
    // one hand, and the game-over dialog is `aria-modal`, which hides the anotador
    // from the accessibility tree -- so that counts as "somebody scored" too.
    const scoreboard = page.getByLabel(/^Anotador:/);
    let finalLabel: string | null = null;
    let finished = false;

    // Bounded by the clock rather than by a move count: the ai pauses to think, and
    // several of those pauses can pass without the human having anything to do.
    const deadline = Date.now() + 55_000;
    while (Date.now() < deadline) {
      if (await gameIsOver(page)) {
        finished = true;
        break;
      }
      const label = await scoreboard.getAttribute('aria-label').catch(() => null);
      if (label !== null && !/\b0, la máquina 0\b/.test(label)) {
        finalLabel = label;
        break;
      }
      await takeTurn(page);
      await page.waitForTimeout(350);
    }

    expect(finished || finalLabel !== null, 'nadie anotó en 55 segundos').toBe(true);
    if (finished) {
      await expect(page.getByRole('dialog')).toContainText(/Ganaste|Perdiste/);
      return;
    }

    // The log records what happened.
    await page.getByRole('button', { name: /Historial/ }).click();
    await expect(page.locator('#hand-log-body li').first()).toBeVisible();
  });

  test('canta envido y truco, y el servidor contesta', async ({ page }) => {
    await startGame(page, { difficulty: 'Fácil' });

    // At the start of a hand, with no card played, the envido and truco are on offer.
    const calls = await offeredCalls(page);
    const hasEnvido = calls.some((text) => text.includes('Envido'));
    const hasTruco = calls.some((text) => text.includes('Truco'));

    if (hasEnvido) {
      await page.getByTestId('action-envido').click();
      // Either the ai answers, or it raises and now we must answer.
      await expect(page.getByText(/Envido/).first()).toBeVisible();
    } else if (hasTruco) {
      await page.getByTestId('action-truco').click();
      await expect(page.getByText(/La mano vale [234]|Historial/).first()).toBeVisible();
    }

    // Whatever happened, the table is still playable and the score is consistent.
    await expect(page.getByLabel(/Anotador:/)).toBeVisible();
  });

  test('el teclado alcanza para jugar', async ({ page }) => {
    await startGame(page, { difficulty: 'Fácil' });
    const calls = await offeredCalls(page);
    // The ai may be mano and may have opened with a call, in which case there is no
    // truco to shout; the shortcut is covered by the component tests either way.
    if (!calls.some((text) => text.includes('Truco'))) return;

    await page.keyboard.press('t');
    // The call landed: the server took it off the table of legal moves. Whether the
    // ai then accepts, raises or folds is its business.
    await expect(page.getByTestId('action-truco')).toBeHidden();
  });

  test('empieza una partida nueva desde el menú', async ({ page }) => {
    await startGame(page);
    await page.getByRole('button', { name: 'Reglas' }).click();
    await expect(page.getByRole('heading', { name: 'Reglas', level: 1 })).toBeVisible();
    await expect(page.getByText(/Baraja española de 40 cartas/)).toBeVisible();
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.getByRole('group', { name: 'Tus cartas' })).toBeVisible();
  });
});

test.describe('información oculta', () => {
  test('nada de lo que cruza el websocket revela cartas tapadas del rival', async ({ page }) => {
    const captured = captureSocket(page);
    await startGame(page, { difficulty: 'Fácil' });

    await playFor(page, 14);
    await page.waitForTimeout(800);

    expect(captured.frames.length).toBeGreaterThan(3);

    // Rebuild what the player was entitled to see, straight from the views received.
    const allowed = new Set<string>();
    const mentioned = new Set<string>();
    const cardId = (card: { rank: number; suit: string }) => `${card.rank}-${card.suit}`;

    for (const raw of captured.frames) {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message['type'] === 'view') {
        const view = message['view'] as {
          myDealtHand: { rank: number; suit: string }[];
          knownOpponentCards: { rank: number; suit: string }[];
          tricks: { plays: { card: { rank: number; suit: string } }[] }[];
        };
        for (const card of view.myDealtHand) allowed.add(cardId(card));
        for (const card of view.knownOpponentCards) allowed.add(cardId(card));
        for (const trick of view.tricks) {
          for (const play of trick.plays) allowed.add(cardId(play.card));
        }
      }
      for (const match of raw.matchAll(/"rank":(\d+),"suit":"(\w+)"/g)) {
        mentioned.add(`${match[1]}-${match[2]}`);
      }
      for (const match of raw.matchAll(/"(\d{1,2}-(?:espada|basto|oro|copa))"/g)) {
        mentioned.add(match[1]!);
      }
    }

    expect(mentioned.size).toBeGreaterThan(3);
    for (const id of mentioned) {
      expect(allowed.has(id), `${id} cruzó el websocket sin haber sido público`).toBe(true);
    }
  });

  test('el DOM solo contiene cartas propias o jugadas', async ({ page }) => {
    await startGame(page, { difficulty: 'Fácil' });
    await playFor(page, 8);

    // Every card face rendered anywhere on the page. `allInnerTexts` does not work on
    // SVG <title>, so the text is read directly.
    const titles = (selector: string) =>
      page
        .locator(selector)
        .evaluateAll((nodes) =>
          nodes.map((node) => (node.textContent ?? '').trim()).filter((text) => text.length > 0),
        );

    const rendered = await titles('svg[role="img"] title');
    const mine = await titles('.player-hand svg[role="img"] title');
    const onTable = await titles('.trick-area svg[role="img"] title');
    const inRules = await titles('.hierarchy svg[role="img"] title');

    // The test is only meaningful if cards were actually drawn.
    expect(rendered.length).toBeGreaterThan(0);

    const public_ = new Set([...mine, ...onTable, ...inRules]);
    for (const label of rendered) {
      expect(public_.has(label), `${label} aparece en el DOM sin ser pública`).toBe(true);
    }

    // And the opponent's hand is nothing but backs.
    const backs = await page.locator('.opponent-hand svg[role="img"]').count();
    const faces = await page.locator('.opponent-hand svg[role="img"] title').count();
    expect(faces).toBe(0);
    expect(backs).toBeGreaterThanOrEqual(0);
  });
});

test.describe('se juega en el celular', () => {
  // Sized from the first paint rather than resized mid-test, so the layout is laid
  // out for a phone exactly as it would be on one.
  test.use({ viewport: { width: 390, height: 844 } });

  test('entra todo a 390px sin scroll horizontal', async ({ page }) => {
    await startGame(page);
    // Let the deal animation finish: mid-flight cards sit outside the table on
    // purpose, and measuring then would be measuring the animation, not the layout.
    await expect(page.getByRole('group', { name: 'Tus cartas' }).getByRole('button')).toHaveCount(
      3,
    );
    await page.waitForTimeout(1_200);

    // Nothing sticks out past the right edge, and nothing is pushed off the left.
    const overflowing = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return [...document.querySelectorAll('*')]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
        })
        .map((element) => element.className || element.tagName)
        .slice(0, 5);
    });
    expect(overflowing).toEqual([]);

    // And the table fits without the page scrolling.
    const vertical = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(vertical).toBeLessThanOrEqual(2);

    // The hand, the anotador and the action bar are all reachable on screen.
    await expect(page.getByRole('group', { name: 'Tus cartas' })).toBeVisible();
    await expect(page.getByLabel(/Anotador:/)).toBeVisible();

    // Cards stay big enough to tap comfortably.
    const card = page.getByRole('group', { name: 'Tus cartas' }).getByRole('button').first();
    const box = await card.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

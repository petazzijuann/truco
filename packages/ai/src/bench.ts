/**
 * AI benchmark. Run with `pnpm bench:ai`.
 *
 * Plays a series between each pair of levels, swapping seats every game, and checks
 * the results against the thresholds the project commits to. Exits non-zero when a
 * threshold is missed, so it works as a gate and not just as a report.
 *
 * Override the series length with `GAMES=200 pnpm bench:ai`.
 */
import { defaultConfig, seededRng, type PlayerView } from '@truco/shared';
import { decide, randomPolicy, type AIConfig } from './index.js';
import { playSeries, type Policy } from './match.js';

const GAMES = Number(process.env.GAMES ?? 500);
const CONFIG = defaultConfig();

const bot = (difficulty: AIConfig['difficulty'], seed: number): Policy => {
  // A generous budget: the benchmark measures strength, not latency.
  const config: AIConfig = { difficulty, rng: seededRng(seed), budgetMs: Infinity };
  return (view: PlayerView) => decide(view, config);
};

const random = (seed: number): Policy => {
  const rng = seededRng(seed);
  return (view: PlayerView) => randomPolicy(view, rng);
};

type Check = {
  label: string;
  challenger: Policy;
  incumbent: Policy;
  /** Minimum win rate the challenger must reach. */
  floor: number;
};

const checks: Check[] = [
  {
    label: 'dificil vs aleatoria',
    challenger: bot('dificil', 11),
    incumbent: random(12),
    floor: 0.85,
  },
  {
    label: 'dificil vs facil',
    challenger: bot('dificil', 13),
    incumbent: bot('facil', 14),
    floor: 0.6,
  },
  {
    label: 'dificil vs normal',
    challenger: bot('dificil', 15),
    incumbent: bot('normal', 16),
    floor: 0,
  },
  {
    label: 'normal vs facil',
    challenger: bot('normal', 17),
    incumbent: bot('facil', 18),
    floor: 0,
  },
  { label: 'normal vs aleatoria', challenger: bot('normal', 19), incumbent: random(20), floor: 0 },
  { label: 'facil vs aleatoria', challenger: bot('facil', 21), incumbent: random(22), floor: 0 },
];

console.log(`Benchmark de IA: ${GAMES} partidas por enfrentamiento, a ${CONFIG.target} puntos`);
console.log('-'.repeat(78));

let failed = false;
for (const check of checks) {
  const started = Date.now();
  const result = playSeries(check.challenger, check.incumbent, GAMES, seededRng(2024), CONFIG);
  const rate = result.rate;
  const ok = rate >= check.floor;
  if (!ok) failed = true;

  const requirement =
    check.floor > 0 ? `requiere >=${(check.floor * 100).toFixed(0)}%` : 'informativo';
  const mark = check.floor > 0 ? (ok ? 'OK  ' : 'FALLA') : '--  ';
  console.log(
    `${mark} ${check.label.padEnd(22)} ${(rate * 100).toFixed(1).padStart(5)}%  ` +
      `(${result.wins.human}-${result.wins.ai}, ${result.averageHands.toFixed(1)} manos/partida, ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s)  ${requirement}`,
  );
}

console.log('-'.repeat(78));
if (failed) {
  console.error('El benchmark no alcanzó los umbrales requeridos.');
  process.exit(1);
}
console.log('Todos los umbrales cumplidos.');

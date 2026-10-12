import { classify } from "./classify.ts";
import type { Point } from "./classify.ts";

export type Label = "legitimate" | "suspicious" | "borderline";
export type Family =
  | "organic"
  | "bought_spike"
  | "mechanical"
  | "borderline"
  | "live_end"
  | "day_night"
  | "small_creator"
  | "slow_buy";
export type Sample = { id: string; family: Family; label: Label; points: Point[] };

export const DATASET_SEED = 7;
const START = Date.parse("2026-06-01T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

function toPoints(views: number[]): Point[] {
  return views.map((v, i) => ({ hour: new Date(START + i * HOUR_MS).toISOString(), views: v }));
}

// O arredondamento pode fabricar platô (várias horas com o mesmo inteiro). Esta
// passagem quebra qualquer sequência antes de 6 somando um inteiro pequeno.
function breakRuns(views: number[], rand: () => number): number[] {
  const out = [...views];
  let run = 1;
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] === out[i - 1]) {
      run += 1;
      if (run >= 3) {
        out[i] = out[i]! + 1 + Math.floor(rand() * 3);
        run = 1;
      }
    } else {
      run = 1;
    }
  }
  return out;
}

function noisyBase(rand: () => number, base: number, hours: number): number[] {
  return Array.from({ length: hours }, () => Math.max(0, Math.round(base * between(rand, 0.85, 1.15))));
}

// Vídeo que estourou: sobe, fica perto do pico por 4 horas e decai por 0,75.
function organic(rand: () => number): number[] {
  const base = between(rand, 30, 400);
  const peak = base * between(rand, 4, 30);
  const flatBefore = 6 + Math.floor(rand() * 10);
  const rise = 2 + Math.floor(rand() * 4);
  const views: number[] = [];
  for (let i = 0; i < flatBefore; i += 1) views.push(base * between(rand, 0.85, 1.15));
  for (let i = 1; i <= rise; i += 1) views.push(base + ((peak - base) * i) / (rise + 1));
  for (let i = 0; i < 4; i += 1) views.push(peak * between(rand, 0.9, 1.0));
  let level = peak;
  while (views.length < 48) {
    level = Math.max(base, level * 0.75);
    views.push(level * between(rand, 0.92, 1.08));
  }
  return breakRuns(views.slice(0, 48).map((v) => Math.round(v)), rand);
}

// 48 horas na base e uma hora comprada a 80 vezes a base.
function boughtSpike(rand: () => number): number[] {
  const base = between(rand, 15, 60);
  const views = noisyBase(rand, base, 48);
  const at = 4 + Math.floor(rand() * 40);
  views.splice(at, 0, Math.round(base * 80));
  return breakRuns(views, rand);
}

// Série comum com um miolo de 8 horas no mesmo inteiro.
function mechanical(rand: () => number): number[] {
  const base = between(rand, 100, 500);
  const views = breakRuns(noisyBase(rand, base, 48), rand);
  const plateau = Math.round(between(rand, 300, 900));
  const at = 10 + Math.floor(rand() * 25);
  for (let i = at; i < at + 8; i += 1) views[i] = plateau;
  return views;
}

// Uma hora a 8 vezes a base: pico isolado, mas abaixo do limiar de compra.
function borderline(rand: () => number): number[] {
  const base = between(rand, 20, 100);
  const views = noisyBase(rand, base, 48);
  const at = 4 + Math.floor(rand() * 40);
  views[at] = Math.round(base * 8);
  return breakRuns(views, rand);
}

// Live que termina: audiência alta por algumas horas e corte seco no fim.
// Legítima; a queda abrupta sozinha deve ficar inconclusiva, nunca suspeita.
function liveEnd(rand: () => number): number[] {
  const base = between(rand, 30, 80);
  const level = between(rand, 400, 1500);
  const hours = 4 + Math.floor(rand() * 5);
  const views = [...noisyBase(rand, base, 14)];
  for (let i = 0; i < hours; i += 1) views.push(Math.round(level * between(rand, 0.9, 1.1)));
  views.push(...noisyBase(rand, base, 48 - views.length));
  return breakRuns(views, rand);
}

// Público em ciclo dia/noite: sobe de dia e cai de madrugada, por 3 dias.
function dayNight(rand: () => number): number[] {
  const base = between(rand, 80, 600);
  const phase = rand() * 24;
  const views = Array.from({ length: 72 }, (_, h) =>
    Math.round(base * (1 + 0.6 * Math.sin(((h + phase) / 24) * 2 * Math.PI)) * between(rand, 0.9, 1.1)),
  );
  return breakRuns(views, rand);
}

// Criador pequeno: poucas views, ruído alto em termos relativos.
function smallCreator(rand: () => number): number[] {
  return breakRuns(Array.from({ length: 48 }, () => Math.floor(rand() * 15)), rand);
}

// Compra lenta: views compradas entregues com subida e decaimento parecidos com
// os de um viral. É o que este classificador não pega, e entra na medição para
// o README dizer isso com número.
function slowBuy(rand: () => number): number[] {
  return organic(rand);
}

export function generateDataset(seed = DATASET_SEED): Sample[] {
  const rand = mulberry32(seed);
  const families: Array<[Family, Label, number, (r: () => number) => number[]]> = [
    ["organic", "legitimate", 120, organic],
    ["bought_spike", "suspicious", 40, boughtSpike],
    ["mechanical", "suspicious", 40, mechanical],
    ["borderline", "borderline", 20, borderline],
    // Famílias novas entram depois: as séries acima continuam idênticas.
    ["live_end", "legitimate", 20, liveEnd],
    ["day_night", "legitimate", 20, dayNight],
    ["small_creator", "legitimate", 20, smallCreator],
    ["slow_buy", "suspicious", 20, slowBuy],
  ];
  const samples: Sample[] = [];
  for (const [family, label, count, make] of families) {
    for (let i = 0; i < count; i += 1) {
      samples.push({ id: `${family}_${String(i + 1).padStart(3, "0")}`, family, label, points: toPoints(make(rand)) });
    }
  }
  return samples;
}

// Séries legítimas classificadas como suspeitas, sobre o total de legítimas.
// O caso limítrofe não entra na conta.
export function falsePositiveRate(samples: Sample[], classifier = classify): number {
  const legitimate = samples.filter((s) => s.label === "legitimate");
  if (legitimate.length === 0) return 0;
  const flagged = legitimate.filter((s) => classifier(s.points).classification === "suspicious");
  return flagged.length / legitimate.length;
}

// Limite superior do intervalo de Clopper-Pearson (95%, bilateral) para k
// sucessos em n: o maior p com P(X <= k) >= 2,5%. Com 0 em n, é 1 - 0,025^(1/n).
export function upperBound95(k: number, n: number): number {
  if (n === 0 || k >= n) return 1;
  const cdf = (p: number) => {
    let total = 0;
    let term = Math.pow(1 - p, n);
    for (let i = 0; i <= k; i += 1) {
      total += term;
      term *= ((n - i) / (i + 1)) * (p / (1 - p));
    }
    return total;
  };
  let low = k / n;
  let high = 1;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    if (cdf(mid) > 0.025) low = mid;
    else high = mid;
  }
  return low;
}

// O bloco que `npm run dataset` imprime e que o README repete entre marcadores.
export function reportLines(samples: Sample[], classifier = classify): string[] {
  const order: string[] = [];
  const rows = new Map<string, { label: Label; counts: Record<string, number> }>();
  for (const sample of samples) {
    if (!rows.has(sample.family)) {
      order.push(sample.family);
      rows.set(sample.family, { label: sample.label, counts: { legitimate: 0, suspicious: 0, inconclusive: 0 } });
    }
    rows.get(sample.family)!.counts[classifier(sample.points).classification] += 1;
  }
  const legitimate = samples.filter((s) => s.label === "legitimate");
  const suspicious = samples.filter((s) => s.label === "suspicious");
  const flagged = legitimate.filter((s) => classifier(s.points).classification === "suspicious").length;
  const caught = suspicious.filter((s) => classifier(s.points).classification === "suspicious").length;
  return [
    `Séries: ${samples.length} (semente ${DATASET_SEED}), gravadas em dataset/views.json`,
    ...order.map((family) => {
      const row = rows.get(family)!;
      return `${family} (${row.label}): legitimate ${row.counts.legitimate}, suspicious ${row.counts.suspicious}, inconclusive ${row.counts.inconclusive}`;
    }),
    `Falso positivo no dataset: ${falsePositiveRate(samples, classifier).toFixed(4)}`,
    `Limite superior de 95% do falso positivo: ${upperBound95(flagged, legitimate.length).toFixed(4)} (${flagged} de ${legitimate.length} legítimas acusadas)`,
    `Acerto nas suspeitas: ${(caught / suspicious.length).toFixed(4)} (${caught} de ${suspicious.length})`,
  ];
}

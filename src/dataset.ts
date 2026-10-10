import { classify } from "./classify.ts";
import type { Point } from "./classify.ts";

export type Label = "legitimate" | "suspicious" | "borderline";
export type Family = "organic" | "bought_spike" | "mechanical" | "borderline";
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

export function generateDataset(seed = DATASET_SEED): Sample[] {
  const rand = mulberry32(seed);
  const families: Array<[Family, Label, number, (r: () => number) => number[]]> = [
    ["organic", "legitimate", 120, organic],
    ["bought_spike", "suspicious", 40, boughtSpike],
    ["mechanical", "suspicious", 40, mechanical],
    ["borderline", "borderline", 20, borderline],
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

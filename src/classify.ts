export type Point = { hour: string; views: number };
export type Classification = "legitimate" | "suspicious" | "inconclusive";
export type Signal = { name: string; fired: boolean; detail: string };
export type Verdict = { classification: Classification; reason: string; signals: Signal[] };

// Limiares. Ficam juntos para o README e o teste lerem o mesmo número.
export const MIN_POINTS = 12;
export const REPEAT_HOURS = 6;
export const REPEAT_MIN_VIEWS = 300;
export const SPIKE_MIN_VIEWS = 1000;
export const SPIKE_MIN_RATIO = 20;
export const SPIKE_NEIGHBOR_MAX_SHARE = 0.2;
export const NEAR_PEAK_SHARE = 0.4;
export const SUSTAINED_MIN_HOURS = 3;
export const WEAK_SPIKE_MIN_RATIO = 5;
export const DROP_PLATEAU_HOURS = 3;
export const DROP_MIN_LEVEL = 200;
export const DROP_LEVEL_RATIO = 3;
export const DROP_MAX_SHARE = 0.2;
export const MAX_POINTS = 2160; // 90 dias de buckets horários
const HOUR_MS = 60 * 60 * 1000;

// Maior trecho de horas consecutivas. Lacuna não é medição: seis observações
// espalhadas por dez dias não são "seis horas seguidas", e o vizinho de um pico
// só conta se for a hora ao lado. Em empate de tamanho, fica o trecho mais recente.
function longestContiguous(points: Point[]): Point[] {
  let best: Point[] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i += 1) {
    const contiguous = i < points.length && Date.parse(points[i]!.hour) - Date.parse(points[i - 1]!.hour) === HOUR_MS;
    if (contiguous) continue;
    if (i - start >= best.length) best = points.slice(start, i);
    start = i;
  }
  return best;
}

function maxOf(values: number[]): number {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  return max;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function longestRepeat(values: number[]): { value: number; length: number; start: number } {
  let best = { value: 0, length: 0, start: 0 };
  let start = 0;
  for (let i = 1; i <= values.length; i += 1) {
    if (i < values.length && values[i] === values[start]) continue;
    const length = i - start;
    const value = values[start]!;
    // Só conta repetição de volume relevante: zero por seis horas é silêncio, não robô.
    if (value >= REPEAT_MIN_VIEWS && length > best.length) best = { value, length, start };
    start = i;
  }
  return best;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "infinito";
}

// Forma do pico: quantas vezes a mediana das outras horas, se os vizinhos ficam
// baixos e quantas horas chegam perto do topo. Regras 3 a 5 leem daqui.
function analyzePeak(views: number[]) {
  const peak = maxOf(views);
  const peakIndex = views.indexOf(peak);
  const othersMedian = median(views.filter((_, i) => i !== peakIndex));
  const ratio = othersMedian > 0 ? peak / othersMedian : peak > 0 ? Infinity : 0;
  const neighbors = [views[peakIndex - 1], views[peakIndex + 1]].filter((v): v is number => v !== undefined);
  const neighborsLow = peak > 0 && neighbors.every((v) => v <= peak * SPIKE_NEIGHBOR_MAX_SHARE);
  const nearPeakHours = peak > 0 ? views.filter((v) => v >= peak * NEAR_PEAK_SHARE).length : 0;
  const isolatedShape = neighborsLow && nearPeakHours < SUSTAINED_MIN_HOURS;
  const strongSpike = isolatedShape && peak >= SPIKE_MIN_VIEWS && ratio >= SPIKE_MIN_RATIO;
  const weakSpike = isolatedShape && !strongSpike && ratio >= WEAK_SPIKE_MIN_RATIO;
  const sustained = peak > 0 && nearPeakHours >= SUSTAINED_MIN_HOURS;
  return { peak, peakIndex, othersMedian, ratio, nearPeakHours, strongSpike, weakSpike, sustained };
}

// Regra 1 e lacunas: devolve o veredito inconclusivo direto, ou o maior trecho
// de horas consecutivas que dá para analisar.
function analyzableSegment(input: Point[]): { verdict: Verdict } | { points: Point[]; gapSignal: Signal } {
  const sorted = [...input].sort((a, b) => Date.parse(a.hour) - Date.parse(b.hour));

  if (sorted.length < MIN_POINTS) {
    return {
      verdict: {
        classification: "inconclusive",
        reason: `Amostra curta: ${sorted.length} horas, o mínimo é ${MIN_POINTS}. Com tão pouco dado não dá para acusar compra de views.`,
        signals: [{ name: "short_sample", fired: true, detail: `${sorted.length} de ${MIN_POINTS} horas` }],
      },
    };
  }

  const points = longestContiguous(sorted);
  const gapSignal: Signal = {
    name: "gaps",
    fired: points.length < sorted.length,
    detail:
      points.length < sorted.length
        ? `${sorted.length} pontos, maior trecho de horas consecutivas com ${points.length}; só ele foi analisado`
        : "todas as horas são consecutivas",
  };
  if (points.length < MIN_POINTS) {
    return {
      verdict: {
        classification: "inconclusive",
        reason: `A série tem lacunas: o maior trecho de horas consecutivas tem ${points.length} horas, o mínimo é ${MIN_POINTS}. Pontos espaçados não mostram sequência nem pico, então não dá para acusar.`,
        signals: [gapSignal],
      },
    };
  }
  return { points, gapSignal };
}

// Queda abrupta: um patamar de horas altas (acima de 3x a mediana e de 200 views)
// que despenca para 20% ou menos do patamar de uma hora para a outra. Público
// humano esfria aos poucos; views compradas param de uma vez. Sozinha não acusa:
// o fim de uma live também corta assim.
function findAbruptDrop(views: number[]): { from: number; level: number; after: number } | null {
  const level = Math.max(DROP_MIN_LEVEL, median(views) * DROP_LEVEL_RATIO);
  for (let i = DROP_PLATEAU_HOURS; i < views.length; i += 1) {
    const plateau = views.slice(i - DROP_PLATEAU_HOURS, i);
    const low = plateau.reduce((min, v) => Math.min(min, v), Infinity);
    if (low >= level && views[i]! <= low * DROP_MAX_SHARE) return { from: i, level: low, after: views[i]! };
  }
  return null;
}

// Classificação explicável, sem modelo opaco. As regras rodam nesta ordem:
// amostra curta, repetição mecânica, pico isolado, pico fraco, sustentação.
// Na dúvida, não acusa: falso positivo pune criador cujo vídeo estourou de verdade.
export function classify(input: Point[]): Verdict {
  const segment = analyzableSegment(input);
  if ("verdict" in segment) return segment.verdict;
  const { points, gapSignal } = segment;
  const views = points.map((p) => p.views);

  const repeat = longestRepeat(views);
  const mechanical: Signal = {
    name: "mechanical_repeat",
    fired: repeat.length >= REPEAT_HOURS,
    detail:
      repeat.length >= REPEAT_HOURS
        ? `${repeat.length} horas seguidas com exatamente ${repeat.value} views a partir de ${points[repeat.start]!.hour}`
        : `nenhuma sequência de ${REPEAT_HOURS} horas iguais com ${REPEAT_MIN_VIEWS} views ou mais`,
  };

  const { peak, peakIndex, othersMedian, ratio, nearPeakHours, strongSpike, weakSpike, sustained } = analyzePeak(views);
  const spikeDetail = `pico de ${peak} views em ${points[peakIndex]!.hour}, ${fmt(ratio)}x a mediana das outras horas (${fmt(othersMedian)}), ${nearPeakHours} hora(s) com 40% do pico ou mais`;
  const isolated: Signal = { name: "isolated_spike", fired: strongSpike, detail: spikeDetail };
  const weak: Signal = {
    name: "weak_spike",
    fired: weakSpike,
    detail: `limiar de compra: pico >= ${SPIKE_MIN_VIEWS} views e >= ${SPIKE_MIN_RATIO}x a mediana`,
  };
  const sustainedSignal: Signal = {
    name: "sustained_peak",
    fired: sustained,
    detail: `${nearPeakHours} hora(s) com 40% do pico ou mais; sustentação pede ${SUSTAINED_MIN_HOURS}`,
  };
  // Pico na última hora não mostra a hora seguinte: não dá para saber se some
  // (compra) ou se sustenta (viral começando).
  const peakAtEnd = peakIndex === views.length - 1 && (strongSpike || weakSpike);
  const drop = findAbruptDrop(views);
  const dropSignal: Signal = {
    name: "abrupt_drop",
    fired: drop !== null,
    detail: drop
      ? `${DROP_PLATEAU_HOURS} horas com ${drop.level}+ views caem para ${drop.after} em ${points[drop.from]!.hour}`
      : `nenhum patamar de ${DROP_PLATEAU_HOURS} horas que despenque para ${DROP_MAX_SHARE * 100}% de uma hora para a outra`,
  };
  const signals = gapSignal.fired
    ? [mechanical, isolated, weak, sustainedSignal, dropSignal, gapSignal]
    : [mechanical, isolated, weak, sustainedSignal, dropSignal];

  if (mechanical.fired) {
    return {
      classification: "suspicious",
      reason: `Repetição mecânica: ${repeat.length} horas seguidas com exatamente ${repeat.value} views. Público humano não entrega o mesmo número inteiro hora após hora.`,
      signals,
    };
  }
  if (peakAtEnd) {
    return {
      classification: "inconclusive",
      reason: `O maior pico (${peak} views) é a última hora da série. Sem a hora seguinte não dá para ver se ele some, como views compradas, ou se sustenta, como um vídeo estourando. Prefiro esperar mais dados a acusar.`,
      signals,
    };
  }
  if (strongSpike) {
    return {
      classification: "suspicious",
      reason: `Pico isolado de ${peak} views, ${fmt(ratio)} vezes a mediana das outras horas, que some na hora seguinte. Parece views compradas, não alcance orgânico.`,
      signals,
    };
  }
  if (weakSpike) {
    return {
      classification: "inconclusive",
      reason: `Há um pico isolado (${fmt(ratio)} vezes a mediana), mas abaixo do limiar de compra (${SPIKE_MIN_VIEWS} views e ${SPIKE_MIN_RATIO} vezes a mediana). Prefiro não acusar.`,
      signals,
    };
  }
  if (drop) {
    return {
      classification: "inconclusive",
      reason: `Queda abrupta: ${DROP_PLATEAU_HOURS} horas com ${drop.level} views ou mais caem para ${drop.after} de uma hora para a outra. Público humano esfria aos poucos, mas o fim de uma live também corta assim, então sozinha a queda não acusa.`,
      signals,
    };
  }
  if (sustained) {
    return {
      classification: "legitimate",
      reason: `O pico se sustenta: ${nearPeakHours} horas com 40% do pico ou mais, e sem repetição mecânica. É o desenho de um vídeo que estourou de verdade.`,
      signals,
    };
  }
  return {
    classification: "legitimate",
    reason: "Não há repetição mecânica nem pico comprado na série.",
    signals,
  };
}

export type ParsedPoints = { points: Point[] } | { error: string };

// Contrato da API: buckets de hora cheia (minuto, segundo e milissegundo zero,
// em qualquer offset), sem hora repetida, views inteiro seguro >= 0, no máximo
// MAX_POINTS pontos.
export function parsePoints(value: unknown): ParsedPoints {
  if (!Array.isArray(value)) return { error: "points deve ser uma lista" };
  if (value.length > MAX_POINTS) return { error: `no máximo ${MAX_POINTS} horas por série` };
  const points: Point[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const hour = (item as { hour?: unknown })?.hour;
    const views = (item as { views?: unknown })?.views;
    if (typeof hour !== "string" || Number.isNaN(Date.parse(hour))) return { error: "hour inválida" };
    if (typeof views !== "number" || !Number.isSafeInteger(views) || views < 0) {
      return { error: "views deve ser inteiro seguro maior ou igual a 0" };
    }
    const at = Date.parse(hour);
    if (at % HOUR_MS !== 0) return { error: `hour precisa ser uma hora cheia: ${hour}` };
    if (seen.has(at)) return { error: `hora repetida: ${hour}` };
    seen.add(at);
    points.push({ hour: new Date(at).toISOString(), views });
  }
  return { points };
}

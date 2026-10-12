import { describe, expect, it } from "vitest";
import { classify, type Point, type Verdict } from "../src/classify.ts";

const START = Date.UTC(2026, 5, 1);
const series = (views: number[]): Point[] =>
  views.map((v, i) => ({ hour: new Date(START + i * 3_600_000).toISOString(), views: v }));
const fired = (verdict: Verdict, name: string) => verdict.signals.some((s) => s.name === name && s.fired);
// Base com ruído pequeno e sem horas iguais seguidas.
const base = (n: number, level = 50) => Array.from({ length: n }, (_, i) => level + (i % 7));

describe("fronteiras dos limiares", () => {
  it("repetição mecânica: 6 horas iguais disparam, 5 não", () => {
    expect(fired(classify(series([...base(10), ...Array(6).fill(400), ...base(10)])), "mechanical_repeat")).toBe(true);
    expect(fired(classify(series([...base(10), ...Array(5).fill(400), ...base(10)])), "mechanical_repeat")).toBe(false);
  });

  it("repetição mecânica: 300 views disparam, 299 não", () => {
    expect(fired(classify(series([...base(10), ...Array(6).fill(300), ...base(10)])), "mechanical_repeat")).toBe(true);
    expect(fired(classify(series([...base(10), ...Array(6).fill(299), ...base(10)])), "mechanical_repeat")).toBe(false);
  });

  it("pico comprado: 1000 views disparam, 999 não (com razão e vizinhos dentro do limiar)", () => {
    const at = (peak: number) => series([...Array(10).fill(0).map((_, i) => 40 + (i % 3)), peak, ...Array(10).fill(0).map((_, i) => 40 + (i % 3))]);
    expect(classify(at(1000)).classification).toBe("suspicious");
    expect(classify(at(999)).classification).toBe("inconclusive");
  });

  it("pico comprado: 20 vezes a mediana dispara, 19,9 não", () => {
    const flat = (n: number) => Array(n).fill(0).map((_, i) => (i % 2 ? 99 : 101));
    expect(classify(series([...flat(10), 2000, ...flat(10)])).classification).toBe("suspicious");
    expect(classify(series([...flat(10), 1990, ...flat(10)])).classification).toBe("inconclusive");
  });

  it("pico comprado: vizinho em 20% do pico ainda isola, em 21% não", () => {
    const around = (neighbor: number) => series([...base(9), neighbor, 2000, ...base(10)]);
    expect(classify(around(400)).classification).toBe("suspicious");
    expect(fired(classify(around(420)), "isolated_spike")).toBe(false);
  });

  it("sustentação: 3 horas com 40% do pico é legítimo; 2 horas não sustentam", () => {
    expect(classify(series([...base(10), 800, 2000, 800, ...base(10)])).classification).toBe("legitimate");
    expect(fired(classify(series([...base(10), 300, 2000, 800, ...base(10)])), "sustained_peak")).toBe(false);
  });

  it("amostra: 12 horas são analisadas, 11 não", () => {
    expect(classify(series(base(12))).classification).toBe("legitimate");
    expect(classify(series(base(11))).classification).toBe("inconclusive");
  });
});

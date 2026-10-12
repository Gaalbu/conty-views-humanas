import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "../src/classify.ts";
import { generateDataset, reportLines, upperBound95 } from "../src/dataset.ts";

const dataset = generateDataset(7);
const byFamily = (family: string) => dataset.filter((s) => s.family === family);

describe("relatório do dataset", () => {
  it("o bloco do README é a saída de npm run dataset", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const block = /<!-- dataset:inicio -->\s*```text\n([\s\S]*?)\n```\s*<!-- dataset:fim -->/.exec(readme);
    expect(block?.[1]?.split("\n")).toEqual(reportLines(dataset));
  });

  it("limite superior de 95% bate com a forma fechada quando não há acusação, e cresce com k", () => {
    expect(upperBound95(0, 180)).toBeCloseTo(1 - Math.pow(0.025, 1 / 180), 6);
    expect(upperBound95(5, 10)).toBeCloseTo(0.8129, 3);
    expect(upperBound95(1, 180)).toBeGreaterThan(upperBound95(0, 180));
  });

  it("fim de live, com queda abrupta, nunca é acusado: fica inconclusivo", () => {
    for (const sample of byFamily("live_end")) {
      const verdict = classify(sample.points);
      expect([sample.id, verdict.classification]).toEqual([sample.id, "inconclusive"]);
    }
  });

  it("ciclo dia/noite e criador pequeno não são acusados", () => {
    for (const sample of [...byFamily("day_night"), ...byFamily("small_creator")]) {
      expect([sample.id, classify(sample.points).classification]).not.toEqual([sample.id, "suspicious"]);
    }
  });

  it("compra lenta com forma de viral passa despercebida, como o README declara", () => {
    expect(byFamily("slow_buy").every((s) => classify(s.points).classification !== "suspicious")).toBe(true);
  });

  it("as 220 séries de antes das famílias novas continuam idênticas (hash do JSON publicado antes)", () => {
    const digest = createHash("sha256").update(JSON.stringify(dataset.slice(0, 220))).digest("hex");
    expect(digest).toBe("ee6049d04c6516bcbb5f0887dcbaaae81bd4479c90d7aed448772fe3f0b003f2");
  });
});

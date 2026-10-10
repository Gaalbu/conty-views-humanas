import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { Verdict } from "../src/classify.ts";
import { falsePositiveRate, generateDataset } from "../src/dataset.ts";
import type { Family } from "../src/dataset.ts";

const dataset = generateDataset(7);
const first = (family: Family) => dataset.find((s) => s.family === family)!;
const app = createApp();

const README_EXAMPLE = [40, 38, 42, 41, 39, 2000, 45, 40, 37, 43, 41, 39].map((views, i) => ({
  hour: new Date(Date.UTC(2026, 5, 1, i)).toISOString(),
  views,
}));

async function classifyViaApi(points: unknown): Promise<{ status: number; verdict: Verdict }> {
  const res = await app.request("/classifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ points }),
  });
  return { status: res.status, verdict: (await res.json()) as Verdict };
}

describe("views que não parecem humanas", () => {
  it("uma série orgânica do gerador é legitimate", async () => {
    const { status, verdict } = await classifyViaApi(first("organic").points);
    expect(status).toBe(200);
    expect(verdict.classification).toBe("legitimate");
    expect(verdict.signals.find((s) => s.name === "sustained_peak")?.fired).toBe(true);
  });

  it("uma série de pico comprado é suspicious e o motivo cita o pico", async () => {
    const { verdict } = await classifyViaApi(first("bought_spike").points);
    expect(verdict.classification).toBe("suspicious");
    expect(verdict.reason.toLowerCase()).toContain("pico");
    expect(verdict.signals.find((s) => s.name === "isolated_spike")?.fired).toBe(true);
  });

  it("uma série mecânica é suspicious e o motivo cita repetição", async () => {
    const { verdict } = await classifyViaApi(first("mechanical").points);
    expect(verdict.classification).toBe("suspicious");
    expect(verdict.reason.toLowerCase()).toContain("repetição");
    expect(verdict.signals.find((s) => s.name === "mechanical_repeat")?.fired).toBe(true);
  });

  it("o caso limítrofe é inconclusive e não acusa", async () => {
    const { verdict } = await classifyViaApi(first("borderline").points);
    expect(verdict.classification).toBe("inconclusive");
    expect(verdict.reason).toContain("Prefiro não acusar");
  });

  it("a orgânica que estourou e a comprada não caem na mesma classificação", async () => {
    const organic = await classifyViaApi(first("organic").points);
    const bought = await classifyViaApi(first("bought_spike").points);
    expect(organic.verdict.classification).not.toBe(bought.verdict.classification);
  });

  it("amostra com menos de 12 horas é inconclusive", async () => {
    const points = first("bought_spike").points.slice(0, 11);
    const { verdict } = await classifyViaApi(points);
    expect(verdict.classification).toBe("inconclusive");
    expect(verdict.reason).toContain("Amostra curta");
  });

  it("a taxa de falso positivo medida é a mesma linha do README", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const match = /Falso positivo no dataset: ([0-9.]+)/.exec(readme);
    expect(match?.[1]).toBe(falsePositiveRate(dataset).toFixed(4));
  });

  it("duas gerações com a semente 7 produzem o mesmo JSON", () => {
    expect(JSON.stringify(generateDataset(7))).toBe(JSON.stringify(generateDataset(7)));
  });

  it("exemplo do README: 12 horas perto de 40 views e uma hora com 2000 é pico comprado", async () => {
    const { status, verdict } = await classifyViaApi(README_EXAMPLE);
    expect(status).toBe(200);
    expect(verdict.classification).toBe("suspicious");
    expect(verdict.signals.find((s) => s.name === "isolated_spike")?.fired).toBe(true);
  });

  it("série com hora inválida ou views negativas é 400", async () => {
    expect((await classifyViaApi([{ hour: "ontem", views: 1 }])).status).toBe(400);
    expect((await classifyViaApi([{ hour: "2026-06-01T00:00:00.000Z", views: -3 }])).status).toBe(400);
  });
});

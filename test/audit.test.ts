import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { classify, type Point, type Verdict } from "../src/classify.ts";

const HOUR_MS = 60 * 60 * 1000;
const START = Date.UTC(2026, 5, 1);

function series(count = 12, interval = HOUR_MS): Point[] {
  return Array.from({ length: count }, (_, index) => ({
    hour: new Date(START + index * interval).toISOString(),
    views: 40 + (index % 5),
  }));
}

async function requestPoints(points: Point[]): Promise<Response> {
  return createApp().request("/classifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ points }),
  });
}

describe("regressões de cadência e limites da auditoria", () => {
  it("não acusa repetição mecânica em observações separadas por 48 horas", async () => {
    const points = series(12, 48 * HOUR_MS);
    for (const point of points.slice(0, 6)) point.views = 300;

    const response = await requestPoints(points);
    const verdict = (await response.json()) as Verdict;

    expect(response.status).toBe(200);
    expect(verdict.classification).toBe("inconclusive");
    expect(verdict.signals.some((signal) => signal.name === "mechanical_repeat" && signal.fired)).toBe(false);
  });
  it("o classificador puro também trata lacunas como dados insuficientes", () => {
    const points = series(12, 48 * HOUR_MS).map((point) => ({ ...point, views: 300 }));
    expect(classify(points).classification).toBe("inconclusive");
  });
  it("rejeita doze observações em minutos distintos da mesma hora", async () => {
    expect((await requestPoints(series(12, 60 * 1000))).status).toBe(400);
  });
  it("rejeita buckets com segundos ou milissegundos fora da hora completa", async () => {
    const points = series();
    points[0] = { hour: "2026-06-01T00:00:00.001Z", views: 40 };
    expect((await requestPoints(points)).status).toBe(400);
  });
  it("rejeita o mesmo instante expresso em offsets equivalentes", async () => {
    const points = series();
    points.push({ hour: "2026-05-31T21:00:00-03:00", views: 40 });
    expect((await requestPoints(points)).status).toBe(400);
  });
  it("mantém a classificação legítima de uma série contínua normal", async () => {
    const response = await requestPoints(series());
    expect(response.status).toBe(200);
    expect(((await response.json()) as Verdict).classification).toBe("legitimate");
  });
  it.each([-3, 3])("aceita horas UTC equivalentes representadas com offset %i", async (offsetHours) => {
    const points = series();
    const suffix = offsetHours < 0 ? "-03:00" : "+03:00";
    const withOffset = points.map((point) => ({
      ...point,
      hour: new Date(Date.parse(point.hour) + offsetHours * HOUR_MS).toISOString().replace("Z", suffix),
    }));
    const response = await requestPoints(withOffset);
    const control = await requestPoints(points);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(await control.json());
  });
});

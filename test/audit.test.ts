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
  it("rejeita views inteiras acima do limite seguro de precisão", async () => {
    const points = series();
    points[0]!.views = Number.MAX_SAFE_INTEGER + 1;
    expect((await requestPoints(points)).status).toBe(400);
  });
  it("aceita o limite de 2160 buckets horários", async () => {
    const response = await requestPoints(series(2160));
    expect(response.status).toBe(200);
    expect(((await response.json()) as Verdict).classification).toBe("legitimate");
  });
  it("rejeita 2161 buckets mesmo com corpo inferior a 256 KiB", async () => {
    const points = series(2161);
    expect(Buffer.byteLength(JSON.stringify({ points }))).toBeLessThan(256 * 1024);
    expect((await requestPoints(points)).status).toBe(400);
  });
  it("rejeita corpo acima de 256 KiB quando Content-Length informa o tamanho", async () => {
    const body = JSON.stringify({ points: series(), padding: "a".repeat(256 * 1024) });
    const response = await createApp().request("/classifications", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
      body,
    });
    expect(response.status).toBe(413);
  });
  it("conta bytes recebidos e rejeita corpo grande em stream sem Content-Length", async () => {
    const body = JSON.stringify({ points: series(), padding: "é".repeat(140_000) });
    const bytes = new TextEncoder().encode(body);
    expect(body.length).toBeLessThan(256 * 1024);
    expect(bytes.byteLength).toBeGreaterThan(256 * 1024);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 16 * 1024, bytes.byteLength);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    };
    const request = new Request("http://localhost/classifications", init);
    expect(request.headers.has("content-length")).toBe(false);

    expect((await createApp().request(request)).status).toBe(413);
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
  it("o classificador puro não estoura a pilha ao receber uma série extensa", () => {
    const points = series(150_000);
    expect(() => classify(points)).not.toThrow();
  });
});

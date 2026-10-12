import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { classify, parsePoints } from "./classify.ts";

export const MAX_BODY_BYTES = 256 * 1024;

export function createApp() {
  const app = new Hono();

  // 2160 pontos cabem com folga; o limite vale com ou sem Content-Length.
  app.post(
    "/classifications",
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "corpo acima de 256 KiB" }, 413) }),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = parsePoints((body as { points?: unknown } | null)?.points);
      if ("error" in parsed) return c.json({ error: parsed.error }, 400);
      return c.json(classify(parsed.points));
    },
  );

  app.notFound((c) => c.json({ error: "rota não encontrada" }, 404));

  return app;
}

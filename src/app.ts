import { Hono } from "hono";
import { classify, parsePoints } from "./classify.ts";

export function createApp() {
  const app = new Hono();

  app.post("/classifications", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = parsePoints((body as { points?: unknown } | null)?.points);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    return c.json(classify(parsed.points));
  });

  return app;
}

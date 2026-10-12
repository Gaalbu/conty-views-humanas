import { expect, it } from "vitest";
import { createApp } from "../src/app.ts";

it("rota inexistente responde 404 em JSON", async () => {
  const app = createApp();
  const res = await app.request("/nao-existe");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "rota não encontrada" });
});

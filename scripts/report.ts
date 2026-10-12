import { mkdirSync, writeFileSync } from "node:fs";
import { generateDataset, reportLines } from "../src/dataset.ts";

const samples = generateDataset();
const dir = new URL("../dataset/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("views.json", dir), `${JSON.stringify(samples, null, 2)}\n`);
for (const line of reportLines(samples)) console.log(line);

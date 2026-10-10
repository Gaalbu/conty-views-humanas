import { mkdirSync, writeFileSync } from "node:fs";
import { classify } from "../src/classify.ts";
import { falsePositiveRate, generateDataset } from "../src/dataset.ts";

const samples = generateDataset();
const dir = new URL("../dataset/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("views.json", dir), `${JSON.stringify(samples, null, 2)}\n`);

const table = new Map<string, Map<string, number>>();
for (const sample of samples) {
  const row = table.get(sample.family) ?? new Map<string, number>();
  const got = classify(sample.points).classification;
  row.set(got, (row.get(got) ?? 0) + 1);
  table.set(sample.family, row);
}

console.log(`Séries: ${samples.length} (semente 7), gravadas em dataset/views.json`);
for (const [family, row] of table) {
  const cells = ["legitimate", "suspicious", "inconclusive"].map((c) => `${c} ${row.get(c) ?? 0}`).join(", ");
  console.log(`${family}: ${cells}`);
}
console.log(`Falso positivo no dataset: ${falsePositiveRate(samples).toFixed(4)}`);

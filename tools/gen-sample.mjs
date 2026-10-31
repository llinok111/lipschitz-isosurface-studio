// Deterministic sample generator: writes data/field.json (analytic SDF spec +
// a coarse checksum grid the browser and verify.mjs both re-evaluate).
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_SPEC, DEFAULT_BOUNDS, sampleField } from "../src/core.mjs";

const spec = DEFAULT_SPEC;
const bounds = DEFAULT_BOUNDS;
const coarseN = 24;
const grid = sampleField(spec, coarseN, bounds);

// 6 decimals keeps the file small while staying well inside the 1e-6 check.
const values = Array.from(grid.values, (v) => Number(v.toFixed(6)));

const out = {
  name: "torus-sphere-smooth-union",
  spec,
  bounds,
  coarseN,
  coarseValues: values,
  reference: {
    note: "volume of the n=256 dense surface-nets mesh, produced by bench/bench.mjs",
    resolution: 256,
    volume: 1.812942460286265,
  },
};

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/field.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`wrote data/field.json  coarseN=${coarseN}  samples=${values.length}`);

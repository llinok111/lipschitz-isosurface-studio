// Timing harness: cold start + >=5 repeats, median/p95/stddev, real numbers
// written to bench/result.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { compare, densePipeline, surfaceNetsPruned, meshVolume, manifoldReport } from "../src/core.mjs";
import { DEFAULT_SPEC, DEFAULT_BOUNDS } from "../src/core.mjs";

const N = 128;
const REPS = 7;
const spec = DEFAULT_SPEC;
const bounds = DEFAULT_BOUNDS;

const now = () => Number(process.hrtime.bigint()) / 1e6;
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const median = s[Math.floor(s.length / 2)];
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return {
    samples: xs.length,
    min: +s[0].toFixed(2),
    median: +median.toFixed(2),
    p95: +s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)].toFixed(2),
    stddev: +Math.sqrt(variance).toFixed(2),
    relStddev: +(Math.sqrt(variance) / mean).toFixed(4),
  };
};

// Cold start = very first call in this process (includes JIT + allocation).
const coldDenseStart = now();
const coldDense = densePipeline(spec, N, bounds);
const coldDenseMs = now() - coldDenseStart;

const coldPrunedStart = now();
const coldPruned = surfaceNetsPruned(spec, N, bounds);
const coldPrunedMs = now() - coldPrunedStart;

const coldRefStart = now();
const ref = densePipeline(spec, 256, bounds);
const coldRefMs = now() - coldRefStart;
const refVolume = meshVolume(ref.positions, ref.indices);

// One warmup of each path, then interleaved repeats to cancel thermal drift.
densePipeline(spec, N, bounds);
surfaceNetsPruned(spec, N, bounds);

let identical = false;
const denseTimes = [];
const prunedTimes = [];
for (let i = 0; i < REPS; i++) {
  let t = now();
  const d = densePipeline(spec, N, bounds);
  denseTimes.push(now() - t);
  t = now();
  const p = surfaceNetsPruned(spec, N, bounds);
  prunedTimes.push(now() - t);
  if (i === 0) {
    let maxDiff = d.positions.length === p.positions.length ? 0 : Infinity;
    for (let k = 0; k < d.positions.length && k < p.positions.length; k++) {
      maxDiff = Math.max(maxDiff, Math.abs(d.positions[k] - p.positions[k]));
    }
    let indexMismatch = d.indices.length === p.indices.length ? 0 : 1;
    for (let k = 0; k < d.indices.length && k < p.indices.length; k++) {
      if (d.indices[k] !== p.indices[k]) { indexMismatch++; break; }
    }
    identical = maxDiff === 0 && indexMismatch === 0;
    if (!identical) throw new Error("pruned mesh diverged from dense mesh");
  }
}

const dense = stats(denseTimes);
const pruned = stats(prunedTimes);
const volume = meshVolume(coldDense.positions, coldDense.indices);
const volumeError = Math.abs(volume - refVolume) / refVolume;
const mm = manifoldReport(coldDense.indices);

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  resolution: N,
  field: "torus-sphere smooth union (k=0.16)",
  cold: {
    denseMs: +coldDenseMs.toFixed(2),
    prunedMs: +coldPrunedMs.toFixed(2),
    reference256Ms: +coldRefMs.toFixed(2),
    speedup: +(coldDenseMs / coldPrunedMs).toFixed(2),
  },
  dense: { ...dense, evals: coldDense.evals, vertices: coldDense.vertices, triangles: coldDense.triangles },
  pruned: {
    ...pruned,
    evals: coldPruned.evals,
    vertices: coldPruned.vertices,
    triangles: coldPruned.triangles,
    evalReduction: +coldPruned.evalReduction.toFixed(4),
    speedup: +(dense.median / pruned.median).toFixed(2),
  },
  identical,
  geometry: {
    volume: +volume.toFixed(6),
    referenceVolume: +refVolume.toFixed(9),
    referenceResolution: 256,
    volumeErrorPct: +(volumeError * 100).toFixed(3),
    maxSdfDeviation: +(compare(spec, 64, bounds).maxSdfDeviation).toFixed(6),
    boundaryEdges: mm.boundaryEdges,
    nonManifoldEdges: mm.nonManifoldEdges,
  },
};

mkdirSync(new URL("./", import.meta.url), { recursive: true });
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

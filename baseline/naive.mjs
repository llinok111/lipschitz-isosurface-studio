// Baseline: dense evaluation + surface nets, no pruning. Run: node baseline/naive.mjs
import { densePipeline, DEFAULT_SPEC } from "../src/core.mjs";

const N = 128;
const t0 = performance.now();
const mesh = densePipeline(DEFAULT_SPEC, N);
const ms = performance.now() - t0;
console.log(JSON.stringify({
  baseline: "dense",
  resolution: N,
  ms: +ms.toFixed(2),
  sdfEvals: mesh.evals,
  vertices: mesh.vertices,
  triangles: mesh.triangles,
}, null, 2));

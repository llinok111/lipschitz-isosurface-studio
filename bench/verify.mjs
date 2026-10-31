// Assertions over the real sample data. Every check prints the measured value.
import { readFileSync } from "node:fs";
import {
  compare, sampleField, meshVolume, manifoldReport, densePipeline,
} from "../src/core.mjs";

const data = JSON.parse(readFileSync(new URL("../data/field.json", import.meta.url)));
const spec = data.spec;
const bounds = data.bounds;
let failed = 0;

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!ok) failed++;
}

// 1. Sample data regenerates the same coarse field as core (1e-6 tolerance).
const regen = sampleField(spec, data.coarseN, bounds);
let maxSampleDiff = 0;
for (let i = 0; i < regen.values.length; i++) {
  maxSampleDiff = Math.max(maxSampleDiff, Math.abs(regen.values[i] - data.coarseValues[i]));
}
check("sample data matches core field", maxSampleDiff <= 1e-6,
  `maxDiff=${maxSampleDiff.toExponential(2)} over ${regen.values.length} samples`);

// 2. Dense 64^3 mesh is a closed 2-manifold.
const r = compare(spec, 64, bounds);
const mm = manifoldReport(r.mesh.indices);
check("closed manifold", mm.boundaryEdges === 0 && mm.nonManifoldEdges === 0,
  `boundaryEdges=${mm.boundaryEdges} nonManifoldEdges=${mm.nonManifoldEdges} edges=${mm.edges}`);
check("mesh non-empty", r.dense.vertices > 5000 && r.dense.triangles > 10000,
  `vertices=${r.dense.vertices} triangles=${r.dense.triangles}`);

// 3. Pruned pass reproduces the dense mesh exactly (positions and indices).
check("pruned mesh bit-identical", r.identical && r.maxPositionDiff === 0,
  `maxPositionDiff=${r.maxPositionDiff} vertices=${r.pruned.vertices}`);

// 4. Evaluation budget really drops.
check("SDF evaluations reduced > 80%", r.pruned.evalReduction > 0.8,
  `dense=${r.dense.evals} pruned=${r.pruned.evals} reduction=${(r.pruned.evalReduction * 100).toFixed(1)}%`);

// 5. Surface accuracy against the analytic field and the 256^3 reference volume.
check("max |sdf(vertex)| < 0.002", r.maxSdfDeviation < 0.002,
  `maxDeviation=${r.maxSdfDeviation.toExponential(3)}`);

const ref = densePipeline(spec, 256, bounds);
const refVolume = meshVolume(ref.positions, ref.indices);
const volumeError = Math.abs(r.volume - refVolume) / refVolume;
check("volume error vs 256^3 < 0.5%", volumeError < 0.005,
  `volume=${r.volume.toFixed(5)} reference=${refVolume.toFixed(5)} error=${(volumeError * 100).toFixed(3)}%`);
check("sample reference volume matches bench", Math.abs(refVolume - data.reference.volume) < 1e-9,
  `reference=${refVolume.toFixed(9)} file=${data.reference.volume}`);

// 6. Determinism: a second identical run yields identical bytes.
const a = densePipeline(spec, 64, bounds);
const b = densePipeline(spec, 64, bounds);
let same = a.positions.length === b.positions.length && a.indices.length === b.indices.length;
if (same) for (let i = 0; i < a.positions.length; i++) if (a.positions[i] !== b.positions[i]) { same = false; break; }
check("deterministic re-run", same, `positions=${a.positions.length} indices=${a.indices.length}`);

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);

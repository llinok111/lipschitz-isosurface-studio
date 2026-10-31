# Lipschitz Isosurface Studio

**Promise:** on a 128³ grid, pruning SDF evaluation with the field's 1-Lipschitz bound cuts sample evaluations from **2,146,689 to 144,357 (−93.3%)** and median mesh-build time from **183.7 ms to 86.4 ms (2.13×)** while producing a mesh that is **bit-identical** (max vertex delta `0`, same index buffer) to the dense pass, closed and manifold (0 non-manifold edges, 0 boundary edges). Baseline: the dense `sampleField` + `surfaceNets` path in `src/core.mjs`, driven by `baseline/naive.mjs`.

Upstream: none

This is an original geometry tool: a signed-distance-field (SDF) isosurface extractor using dual-contour "surface nets", accelerated by an octree that skips any node whose centre is farther from the surface than the node's bounding-sphere radius. Because both operands of the field are exact distances, `|f|` is a valid lower bound on distance-to-surface, so skipping is **provably lossless** — not an approximation. The demo in the browser runs the same `src/core.mjs` module as node and prints the same counts.

## Run it

```bash
node tools/gen-sample.mjs && node bench/verify.mjs
```

Then open the interactive studio (single file + CDN importmap, no build step):

```bash
python3 -m http.server 4173    # then visit http://localhost:4173
```

## Evidence

`node bench/verify.mjs` (all checks print their measured value):

| check | measured |
| --- | --- |
| sample data regenerates from core | maxDiff `4.99e-7` over 15,625 samples |
| closed 2-manifold | boundaryEdges `0`, nonManifoldEdges `0`, edges `20,730` |
| pruned vs dense mesh | maxPositionDiff `0`, vertices `6,912`, triangles `13,820` (64³) |
| SDF evaluation cut | dense `274,625` → pruned `36,019` (−86.9% at 64³) |
| surface accuracy | max `\|sdf(vertex)\|` = `1.20e-3` |
| volume vs 256³ reference | `1.80721` vs `1.81294` → **0.316%** error (64³) |

`node bench/bench.mjs` (128³, 7 repeats, `bench/result.json`):

| metric | dense baseline | Lipschitz-pruned |
| --- | --- | --- |
| cold start | 253.2 ms | 113.2 ms |
| median | 183.7 ms | 86.4 ms |
| p95 | 256.6 ms | 128.8 ms |
| stddev | 25.8 ms | 16.2 ms |
| SDF evaluations | 2,146,689 | 144,357 (−93.3%) |
| vertices / triangles | 27,640 / 55,276 | identical |

Volume at 128³: `1.811795` vs 256³ reference `1.812942` → **0.063%** error. Relative stddev is 13.3% (dense) / 18.0% (pruned), above 10%: this is a shared 4-core VM and each dense run allocates an 8.6 MB `Float32Array` grid, so GC pauses land inside some samples (visible in the p95). The median is stable across runs; the deterministic evaluation counts are the primary claim, wall-clock the secondary one.

## 本轮创新

First isosurface extractor in this series that uses the SDF's **1-Lipschitz bound as an exact octree pruning oracle**, and proves it by **bit-identical vertex/index output against the dense pass** rather than an error tolerance. Prior rounds in this direction did decimation (QEM/mesh LOD), slicing, point picking, point clouds and adaptive tessellation — none pruned *field evaluation* with a distance bound. The studio also shows the same evaluation counts, triangle counts and volume error live in the browser, computed by the identical `src/core.mjs` that node asserts on, so what you see is what `bench/verify.mjs` re-checks.

## How it works

1. `sdf()` — smooth union (k=0.16) of an exact sphere SDF and an exact torus SDF; 1-Lipschitz.
2. `surfaceNets()` — one dual vertex per sign-changing cell, one quad per sign-changing grid edge; quads are wound by the sign direction so normals point outward.
3. `surfaceNetsPruned()` — octree descent; a node is skipped when `|f(centre)| > halfDiagonal`. Surviving cells are emitted in the same z/y/x order as the dense pass, which is why the output is bit-identical.
4. `compare()` — runs both, checks position/index equality, volume (divergence theorem), manifold edge counts and max `|sdf|` deviation.

## Layout

```
index.html            # importmap entry, three@0.169.0 pinned
main.js               # rendering + orbit + slider; consumes core only
src/core.mjs          # pure SDF / surface-nets / pruning / metrics (no three, no DOM)
tools/gen-sample.mjs  # deterministic data/field.json (spec + 24³ checksum grid)
bench/verify.mjs      # assertions on real data, prints measured values
bench/bench.mjs       # cold start + 7 repeats -> bench/result.json
baseline/naive.mjs    # dense-only baseline, runnable on its own
data/field.json       # generated, 137 KB
```

## Known limitations

- Only one field family (sphere ∪ torus) is shipped; the core is generic over any 1-Lipschitz `f`, but the demo does not load arbitrary SDFs.
- Resolution must be a power of two (the octree requires it); the slider offers 16/32/64/128.
- Surface nets can produce non-manifold vertices in thin features; not observed for this field (asserted at 64³ only).
- Volume error is measured against a 256³ dense reference from the same algorithm, not an analytic integral.
- Browser numbers are computed synchronously; 128³ blocks the main thread for roughly the median time above.

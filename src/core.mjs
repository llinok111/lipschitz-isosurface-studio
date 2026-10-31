// Pure geometry core: signed distance fields, dual-contouring (surface nets)
// isosurface extraction, and Lipschitz-pruned evaluation.
// No three.js, no DOM, no I/O, no side effects at import time.

export const DEFAULT_SPEC = {
  kind: "torusSphere",
  sphere: { cx: 0, cy: 0, cz: 0, r: 0.72 },
  torus: { R: 0.60, r: 0.24 },
  blend: 0.16,
};

export const DEFAULT_BOUNDS = [-1.3, 1.3];

export function makeSpec(overrides = {}) {
  return { ...DEFAULT_SPEC, ...overrides };
}

// Smooth union of a sphere and a torus in the XZ plane. Both operands are
// exact signed distances, so the result is 1-Lipschitz (used by the pruner).
export function sdf(p, spec = DEFAULT_SPEC) {
  const { sphere: s, torus: t, blend: k } = spec;
  const dx = p[0] - s.cx, dy = p[1] - s.cy, dz = p[2] - s.cz;
  const ds = Math.sqrt(dx * dx + dy * dy + dz * dz) - s.r;
  const qx = Math.sqrt(dx * dx + dz * dz) - t.R;
  const dt = Math.sqrt(qx * qx + dy * dy) - t.r;
  if (k <= 0) return Math.min(ds, dt);
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (dt - ds) / k));
  return dt * (1 - h) + ds * h - k * h * (1 - h);
}

// Evaluate the field on a regular grid of n^3 cells ((n+1)^3 corner samples).
export function sampleField(spec, n, bounds = DEFAULT_BOUNDS) {
  const lo = bounds[0], hi = bounds[1];
  const step = (hi - lo) / n;
  const m = n + 1;
  const values = new Float32Array(m * m * m);
  const p = [0, 0, 0];
  let k = 0;
  for (let z = 0; z < m; z++) {
    p[2] = lo + z * step;
    for (let y = 0; y < m; y++) {
      p[1] = lo + y * step;
      for (let x = 0; x < m; x++) {
        p[0] = lo + x * step;
        values[k++] = sdf(p, spec);
      }
    }
  }
  return { n, lo, hi, step, values };
}

const CORNER = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGE = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function cellVertex(grid, ci, values, stride) {
  // ci = [x, y, z] cell origin; values is a flat array indexed by corner id.
  const { lo, step } = grid;
  const [x, y, z] = ci;
  const px = lo + x * step, py = lo + y * step, pz = lo + z * step;
  let sx = 0, sy = 0, sz = 0, count = 0;
  for (let e = 0; e < 12; e++) {
    const a = EDGE[e][0], b = EDGE[e][1];
    const va = values[a], vb = values[b];
    if ((va < 0) === (vb < 0)) continue;
    const t = va / (va - vb);
    const ca = CORNER[a], cb = CORNER[b];
    sx += (ca[0] + t * (cb[0] - ca[0])) * step;
    sy += (ca[1] + t * (cb[1] - ca[1])) * step;
    sz += (ca[2] + t * (cb[2] - ca[2])) * step;
    count++;
  }
  if (count === 0) return null;
  return [px + sx / count, py + sy / count, pz + sz / count];
}

// Build the dual mesh. `active` (optional Uint8Array of n^3 cells) restricts
// which cells may emit a vertex; `values` (optional) supplies a precomputed
// corner field of size (n+1)^3. Both are used by the pruned path.
export function surfaceNets(grid, active = null, values = null) {
  const { n, lo, step } = grid;
  const m = n + 1;
  const field = values || grid.values;
  const positions = [];
  const cellIndex = new Int32Array(n * n * n).fill(-1);
  const cellId = (x, y, z) => (z * n + y) * n + x;
  const corner = new Float64Array(8);
  let cellsScanned = 0;

  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const id = cellId(x, y, z);
        if (active && !active[id]) continue;
        cellsScanned++;
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNER[c];
          const v = field[((z + o[2]) * m + (y + o[1])) * m + (x + o[0])];
          corner[c] = v;
          if (v < 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;
        const v = cellVertex(grid, [x, y, z], corner, 0);
        if (!v) continue;
        cellIndex[id] = positions.length / 3;
        positions.push(v[0], v[1], v[2]);
      }
    }
  }

  const indices = [];
  const edge = (x, y, z) => field[((z) * m + y) * m + x];
  // X edges: (x, y, z) -> (x+1, y, z), 1 <= y,z <= n-1
  for (let z = 1; z < n; z++) {
    for (let y = 1; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v0 = edge(x, y, z), v1 = edge(x + 1, y, z);
        if ((v0 < 0) === (v1 < 0)) continue;
        const c = [
          cellIndex[cellId(x, y - 1, z - 1)],
          cellIndex[cellId(x, y, z - 1)],
          cellIndex[cellId(x, y, z)],
          cellIndex[cellId(x, y - 1, z)],
        ];
        if (c.some((i) => i < 0)) continue;
        pushQuad(indices, c, v0 < 0);
      }
    }
  }
  // Y edges: (x, y, z) -> (x, y+1, z), 1 <= x,z <= n-1
  for (let z = 1; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 1; x < n; x++) {
        const v0 = edge(x, y, z), v1 = edge(x, y + 1, z);
        if ((v0 < 0) === (v1 < 0)) continue;
        const c = [
          cellIndex[cellId(x - 1, y, z - 1)],
          cellIndex[cellId(x - 1, y, z)],
          cellIndex[cellId(x, y, z)],
          cellIndex[cellId(x, y, z - 1)],
        ];
        if (c.some((i) => i < 0)) continue;
        pushQuad(indices, c, v0 < 0);
      }
    }
  }
  // Z edges: (x, y, z) -> (x, y, z+1), 1 <= x,y <= n-1
  for (let z = 0; z < n; z++) {
    for (let y = 1; y < n; y++) {
      for (let x = 1; x < n; x++) {
        const v0 = edge(x, y, z), v1 = edge(x, y, z + 1);
        if ((v0 < 0) === (v1 < 0)) continue;
        const c = [
          cellIndex[cellId(x - 1, y - 1, z)],
          cellIndex[cellId(x, y - 1, z)],
          cellIndex[cellId(x, y, z)],
          cellIndex[cellId(x - 1, y, z)],
        ];
        if (c.some((i) => i < 0)) continue;
        pushQuad(indices, c, v0 < 0);
      }
    }
  }

  return {
    n,
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
    vertices: positions.length / 3,
    triangles: indices.length / 3,
    cellsScanned,
  };
}

function pushQuad(indices, c, forward) {
  // Quad corners are ordered so that (c0,c1,c2) faces the +axis direction;
  // when the edge runs from outside (>=0) to inside (<0), reverse winding.
  if (forward) {
    indices.push(c[0], c[1], c[2], c[0], c[2], c[3]);
  } else {
    indices.push(c[0], c[2], c[1], c[0], c[3], c[2]);
  }
}

// Lipschitz-pruned extraction: a node whose centre is farther from the
// surface than its bounding-sphere radius contains no zero crossing, so all
// its cells are skipped. Surviving cells are emitted in the same order as the
// dense pass, which makes the two meshes bit-identical.
export function surfaceNetsPruned(spec, n, bounds = DEFAULT_BOUNDS) {
  const lo = bounds[0], hi = bounds[1];
  const step = (hi - lo) / n;
  const m = n + 1;
  const memo = new Float32Array(m * m * m).fill(NaN);
  const active = new Uint8Array(n * n * n);
  let evals = 0, nodes = 0, skippedCells = 0, activeCells = 0;
  const p = [0, 0, 0];
  const at = (x, y, z) => {
    const idx = (z * m + y) * m + x;
    let v = memo[idx];
    if (Number.isNaN(v)) {
      p[0] = lo + x * step; p[1] = lo + y * step; p[2] = lo + z * step;
      v = sdf(p, spec);
      memo[idx] = v;
      evals++;
    }
    return v;
  };
  const cellSign = (x, y, z) => {
    let neg = 0;
    for (let c = 0; c < 8; c++) {
      const o = CORNER[c];
      if (at(x + o[0], y + o[1], z + o[2]) < 0) neg++;
    }
    return neg;
  };
  const visit = (x0, y0, z0, size) => {
    nodes++;
    const half = (size * step) / 2;
    p[0] = lo + (x0 + size / 2) * step;
    p[1] = lo + (y0 + size / 2) * step;
    p[2] = lo + (z0 + size / 2) * step;
    const d = sdf(p, spec);
    evals++;
    if (Math.abs(d) > half * Math.sqrt(3)) {
      skippedCells += size * size * size;
      return;
    }
    if (size === 1) {
      const neg = cellSign(x0, y0, z0);
      if (neg > 0 && neg < 8) {
        active[(z0 * n + y0) * n + x0] = 1;
        activeCells++;
      }
      return;
    }
    const h = size / 2;
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++)
          visit(x0 + dx * h, y0 + dy * h, z0 + dz * h, h);
  };
  if ((n & (n - 1)) !== 0) throw new Error("resolution must be a power of two");
  visit(0, 0, 0, n);

  const grid = { n, lo, hi, step };
  const mesh = surfaceNets(grid, active, memo);
  return {
    ...mesh,
    evals,
    nodes,
    activeCells,
    skippedCells,
    cellsTotal: n * n * n,
    evalReduction: 1 - evals / Math.pow(m, 3),
    active,
    values: memo,
    grid,
  };
}

export function densePipeline(spec, n, bounds = DEFAULT_BOUNDS) {
  const grid = sampleField(spec, n, bounds);
  const mesh = surfaceNets(grid);
  return { ...mesh, evals: Math.pow(n + 1, 3), grid };
}

export function meshVolume(positions, indices) {
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function manifoldReport(indices) {
  const edges = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[i + e], b = indices[i + ((e + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const count of edges.values()) {
    if (count === 1) boundary++;
    else if (count !== 2) nonManifold++;
  }
  return { edges: edges.size, boundaryEdges: boundary, nonManifoldEdges: nonManifold };
}

export function maxSdfDeviation(spec, positions) {
  let max = 0;
  const p = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    p[0] = positions[i]; p[1] = positions[i + 1]; p[2] = positions[i + 2];
    const d = Math.abs(sdf(p, spec));
    if (d > max) max = d;
  }
  return max;
}

export function compare(spec, n, bounds = DEFAULT_BOUNDS) {
  const dense = densePipeline(spec, n, bounds);
  const pruned = surfaceNetsPruned(spec, n, bounds);
  let maxDiff = 0;
  if (dense.positions.length !== pruned.positions.length) maxDiff = Infinity;
  else for (let i = 0; i < dense.positions.length; i++) {
    const d = Math.abs(dense.positions[i] - pruned.positions[i]);
    if (d > maxDiff) maxDiff = d;
  }
  let indexMismatch = 0;
  if (dense.indices.length !== pruned.indices.length) indexMismatch = -1;
  else for (let i = 0; i < dense.indices.length; i++) {
    if (dense.indices[i] !== pruned.indices[i]) { indexMismatch++; break; }
  }
  const volume = meshVolume(dense.positions, dense.indices);
  return {
    dense: { evals: dense.evals, vertices: dense.vertices, triangles: dense.triangles },
    pruned: {
      evals: pruned.evals, nodes: pruned.nodes, vertices: pruned.vertices,
      triangles: pruned.triangles, activeCells: pruned.activeCells,
      skippedCells: pruned.skippedCells, cellsTotal: pruned.cellsTotal,
      evalReduction: pruned.evalReduction,
    },
    identical: maxDiff === 0 && indexMismatch === 0,
    maxPositionDiff: maxDiff,
    volume,
    manifold: manifoldReport(dense.indices),
    maxSdfDeviation: maxSdfDeviation(spec, dense.positions),
    mesh: dense,
  };
}

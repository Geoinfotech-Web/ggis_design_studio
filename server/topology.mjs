/**
 * Simplifying boundaries without breaking their topology.
 *
 * Simplify each region's outline on its own and two neighbours no longer
 * agree about where their shared border is: Douglas–Peucker keeps different
 * vertices on each side, and slivers of gap and overlap open up along every
 * border. Clip data to one of them, or dissolve two of them, and those
 * slivers turn into topology errors.
 *
 * The cure is the one TopoJSON uses: a shared border is simplified once, the
 * same way for everyone who shares it. Here that is done without building the
 * whole topology in memory:
 *
 *  1. Every vertex of a level is counted, with a fingerprint of which
 *     features use it (VertexTable).
 *  2. A vertex is *pinned* where that changes — a junction of three units, or
 *     the end of a shared stretch of border. Pins are never removed.
 *  3. Between two pins every neighbour holds the same run of vertices, so
 *     simplifying that run in a canonical direction gives every neighbour
 *     exactly the same result.
 *
 * Whatever the simplification still leaves invalid (a ring crossing itself,
 * a spike) is repaired with a polygon union, which rebuilds clean,
 * non-overlapping rings.
 */

import polygonClipping from 'polygon-clipping';

const SCALE = 1e5;                       // 5 decimals ≈ 1 m
const X_SPAN = 360 * SCALE + 1;

/** One vertex, as an integer key: same position, same key, on whichever ring it appears. */
const keyOf = (ix, iy) => (ix + 180 * SCALE) * X_SPAN + (iy + 90 * SCALE);

/**
 * Open-addressed hash table of vertices: how many rings use each one, and a
 * fingerprint of which features. Typed arrays, because a level holds over ten
 * million vertices — past what a JavaScript Map will hold.
 */
export class VertexTable {
  constructor(bits = 25) {
    this.size = 2 ** bits;
    this.mask = this.size - 1;
    this.keys = new Float64Array(this.size).fill(-1);
    this.count = new Uint16Array(this.size);
    this.owners = new Float64Array(this.size);
    this.used = 0;
  }

  slot(key) {
    let h = Math.imul((key >>> 0) ^ Math.imul(Math.floor(key / 4294967296), 0x9e3779b1), 0x85ebca6b);
    h = (h ^ (h >>> 13)) & this.mask;
    while (this.keys[h] !== -1 && this.keys[h] !== key) h = (h + 1) & this.mask;
    return h;
  }

  add(key, featureId) {
    const h = this.slot(key);
    if (this.keys[h] === -1) {
      if (++this.used > this.size * 0.8) throw new Error('VertexTable full — raise its bits.');
      this.keys[h] = key;
    }
    if (this.count[h] < 65535) this.count[h] += 1;
    // A sum of a mixing of the ids: equal for two vertices only when the
    // same set of features uses both, short of an astronomically rare clash.
    this.owners[h] += Math.imul(featureId, 0x2c1b3c6d) >>> 0;
  }

  get(key) {
    const h = this.slot(key);
    return this.keys[h] === -1 ? null : h;
  }
}

/**
 * A ring snapped to the 1 m grid: integer coordinates, no repeated vertices,
 * the closing vertex dropped. Snapping is what makes a border two neighbours
 * drew with the same points produce the same keys.
 */
export function prepRing(ring) {
  const xs = []; const ys = []; const keys = [];
  for (const [x, y] of ring) {
    const ix = Math.round(x * SCALE); const iy = Math.round(y * SCALE);
    const n = xs.length;
    if (n && xs[n - 1] === ix && ys[n - 1] === iy) continue;
    xs.push(ix); ys.push(iy); keys.push(keyOf(ix, iy));
  }
  if (keys.length > 1 && keys[0] === keys[keys.length - 1]) { xs.pop(); ys.pop(); keys.pop(); }
  return { xs, ys, keys };
}

/** Pass 1: record every vertex of a feature's rings. */
export function countFeature(table, polys, featureId) {
  for (const poly of polys) {
    for (const ring of poly) {
      const { keys } = prepRing(ring);
      for (const key of new Set(keys)) table.add(key, featureId);
    }
  }
}

/** Douglas–Peucker over xs/ys[from..to] (indices into a run), marking keep[]. */
function dp(px, py, keep, tol2) {
  const stack = [[0, px.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = px[a]; const ay = py[a]; const dx = px[b] - ax; const dy = py[b] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1; let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      let d2;
      if (len2 === 0) d2 = (px[i] - ax) ** 2 + (py[i] - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px[i] - ax) * dx + (py[i] - ay) * dy) / len2));
        d2 = (px[i] - ax - t * dx) ** 2 + (py[i] - ay - t * dy) ** 2;
      }
      if (d2 > worst) { worst = d2; at = i; }
    }
    if (at > 0 && worst > tol2) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
}

/**
 * Pass 2: one ring, simplified so that every stretch it shares with a
 * neighbour comes out identical in both. Returns a closed lng/lat ring, or
 * null if it collapses.
 * @param {number} tolerance  degrees
 */
export function simplifyShared(table, ring, tolerance) {
  const { xs, ys, keys } = prepRing(ring);
  const n = keys.length;
  if (n < 3) return null;

  const slots = keys.map((k) => table.get(k));
  const same = (i, j) => {
    const a = slots[i]; const b = slots[j];
    return table.count[a] === table.count[b] && table.owners[a] === table.owners[b];
  };
  const pins = [];
  for (let i = 0; i < n; i += 1) {
    const prev = (i - 1 + n) % n; const next = (i + 1) % n;
    if (table.count[slots[i]] >= 3 || !same(i, prev) || !same(i, next)) pins.push(i);
  }
  // A ring nobody else touches, or one shared whole (an enclave and the hole
  // around it): pin the same two vertices from either side — the lowest key,
  // and the vertex farthest from it.
  if (pins.length < 2) {
    let lo = 0;
    for (let i = 1; i < n; i += 1) if (keys[i] < keys[lo]) lo = i;
    let far = lo; let best = -1;
    for (let i = 0; i < n; i += 1) {
      const d = (xs[i] - xs[lo]) ** 2 + (ys[i] - ys[lo]) ** 2;
      if (d > best || (d === best && keys[i] < keys[far])) { best = d; far = i; }
    }
    pins.length = 0;
    pins.push(...[lo, far].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b));
    if (pins.length < 2) return null;
  }

  const tol2 = (tolerance * SCALE) ** 2;
  const keep = new Uint8Array(n);
  for (let p = 0; p < pins.length; p += 1) {
    const a = pins[p]; const b = pins[(p + 1) % pins.length];
    keep[a] = 1;
    const run = [];
    for (let i = a; ; i = (i + 1) % n) { run.push(i); if (i === b) break; }
    if (run.length < 3) continue;
    // Canonical direction, so the neighbour, walking this border the other
    // way round, makes exactly the same choices.
    if (keys[run[0]] > keys[run[run.length - 1]]) run.reverse();
    const runKeep = new Uint8Array(run.length);
    runKeep[0] = 1; runKeep[run.length - 1] = 1;
    dp(run.map((i) => xs[i]), run.map((i) => ys[i]), runKeep, tol2);
    run.forEach((i, j) => { if (runKeep[j]) keep[i] = 1; });
  }

  const out = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push([xs[i] / SCALE, ys[i] / SCALE]);
  if (out.length < 3) return null;
  out.push([...out[0]]);
  return out;
}

/** Signed-area-free sliver test: a ring that encloses (almost) nothing. */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(a / 2);
}

/**
 * Rebuild polygons as valid geometry: rings that cross themselves are split,
 * overlapping parts merged, orientation made consistent. Returns a list of
 * polygons (MultiPolygon coordinates), or the input unchanged if the repair
 * itself fails.
 */
export function repairPolygons(polys) {
  const clean = polys
    .map((poly) => poly.filter((ring, i) => ring.length >= 4 && (i > 0 || ringArea(ring) > 1e-12)))
    .filter((poly) => poly.length);
  if (!clean.length) return [];
  try {
    return polygonClipping.union(...clean.map((p) => [p]));
  } catch {
    return clean;
  }
}

/* ============================================================
   nav.js -- a hand-placed waypoint graph. The store is small and
   mostly open, so people walk straight lines wherever they can
   and only fall back on the graph to get around the gondolas.
   ============================================================ */
import { clearPath } from './world.js';

export const NODES = [
  { x: 6.00, z: -2.60 },   // 0  street
  { x: 6.00, z: -0.85 },   // 1  outside the door
  { x: 6.00, z: 0.62 },    // 2  just inside
  { x: 6.50, z: 2.15 },    // 3  lobby
  { x: 10.55, z: 0.80 },   // 4  service window
  { x: 9.35, z: 0.78 },    // 5  queue 1
  { x: 8.35, z: 0.82 },    // 6  queue 2
  { x: 0.85, z: 2.78 },    // 7  front run, aisle 0
  { x: 2.60, z: 2.78 },    // 8
  { x: 4.60, z: 2.78 },    // 9
  { x: 6.60, z: 2.78 },    // 10
  { x: 8.55, z: 2.78 },    // 11
  { x: 0.85, z: 8.05 },    // 12 back run
  { x: 2.60, z: 8.05 },    // 13
  { x: 4.60, z: 8.05 },    // 14
  { x: 6.60, z: 8.05 },    // 15
  { x: 8.55, z: 8.05 },    // 16
  { x: 10.90, z: 8.05 },   // 17
];

const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [3, 6], [5, 4], [6, 5],
  [3, 11], [11, 10], [10, 9], [9, 8], [8, 7],
  [7, 12], [8, 13], [9, 14], [10, 15], [11, 16],
  [12, 13], [13, 14], [14, 15], [15, 16], [16, 17],
];

const ADJ = NODES.map(() => []);
for (const [a, b] of EDGES) {
  const w = Math.hypot(NODES[a].x - NODES[b].x, NODES[a].z - NODES[b].z);
  ADJ[a].push([b, w]); ADJ[b].push([a, w]);
}

function nearestNode(x, z, solids, r) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const d = Math.hypot(NODES[i].x - x, NODES[i].z - z);
    if (d < bestD && clearPath(x, z, NODES[i].x, NODES[i].z, solids, r)) { bestD = d; best = i; }
  }
  if (best >= 0) return best;
  // fall back on raw distance if nothing is directly reachable
  for (let i = 0; i < NODES.length; i++) {
    const d = Math.hypot(NODES[i].x - x, NODES[i].z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** @returns array of {x,z} waypoints ending at the target. */
export function navPath(fx, fz, tx, tz, solids, r = 0.32) {
  if (clearPath(fx, fz, tx, tz, solids, r)) return [{ x: tx, z: tz }];
  const a = nearestNode(fx, fz, solids, r);
  const b = nearestNode(tx, tz, solids, r);
  if (a < 0 || b < 0) return [{ x: tx, z: tz }];
  if (a === b) return [NODES[a], { x: tx, z: tz }];

  const dist = new Float64Array(NODES.length).fill(Infinity);
  const prev = new Int32Array(NODES.length).fill(-1);
  const seen = new Uint8Array(NODES.length);
  dist[a] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < NODES.length; i++) if (!seen[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === b) break;
    seen[u] = 1;
    for (const [v, w] of ADJ[u]) {
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
  }
  const out = [];
  for (let c = b; c >= 0; c = prev[c]) { out.unshift(NODES[c]); if (c === a) break; }
  out.push({ x: tx, z: tz });
  return out;
}

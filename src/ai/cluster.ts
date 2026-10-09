// Average-linkage agglomerative clustering with nearest-neighbour bookkeeping (≈O(n²)).

import { cosine } from './vectors';

export function agglomerative(vectors: number[][], threshold: number, maxItems = 800): number[][] {
  const n = Math.min(vectors.length, maxItems);
  if (n === 0) return [];
  if (n === 1) return [[0]];
  const sim = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vectors[i], vectors[j]);
      sim[i * n + j] = s;
      sim[j * n + i] = s;
    }
  }
  const active = new Uint8Array(n).fill(1);
  const size = new Int32Array(n).fill(1);
  const members: number[][] = Array.from({ length: n }, (_, i) => [i]);
  const best = new Int32Array(n);
  const bestSim = new Float32Array(n);

  const recompute = (i: number) => {
    let b = -1;
    let bs = -Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i || !active[j]) continue;
      const s = sim[i * n + j];
      if (s > bs) {
        bs = s;
        b = j;
      }
    }
    best[i] = b;
    bestSim[i] = bs;
  };
  for (let i = 0; i < n; i++) recompute(i);

  for (;;) {
    let a = -1;
    let as = -Infinity;
    for (let i = 0; i < n; i++) {
      if (active[i] && best[i] >= 0 && bestSim[i] > as) {
        as = bestSim[i];
        a = i;
      }
    }
    if (a < 0 || as < threshold) break;
    const b = best[a];
    // Merge b into a (Lance–Williams update for average linkage).
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === a || k === b) continue;
      const s = (size[a] * sim[a * n + k] + size[b] * sim[b * n + k]) / (size[a] + size[b]);
      sim[a * n + k] = s;
      sim[k * n + a] = s;
    }
    size[a] += size[b];
    members[a].push(...members[b]);
    active[b] = 0;
    members[b] = [];
    recompute(a);
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === a) continue;
      if (best[k] === a || best[k] === b) recompute(k);
      else if (sim[k * n + a] > bestSim[k]) {
        best[k] = a;
        bestSim[k] = sim[k * n + a];
      }
    }
  }
  const clusters: number[][] = [];
  for (let i = 0; i < n; i++) if (active[i]) clusters.push(members[i]);
  return clusters.sort((x, y) => y.length - x.length);
}

// Builds an organization *proposal*. Nothing is changed until the user reviews and accepts it.
//
// Pipeline:
//  1. Tabs similar enough to an existing workspace are proposed for it.
//  2. Tabs with a confident topic (site + keywords) are grouped by topic (AI Research, Coding, …).
//  3. Everything else is clustered by embedding similarity.
//  4. Groups are named (built-in heuristics or the configured language model).

import type { OrganizeProposal, ProposedGroup, TabRecord, Workspace, GroupColor } from '../shared/types';
import { GROUP_COLORS } from '../shared/types';
import { matchesAny } from '../shared/url';
import { agglomerative } from './cluster';
import { distinctiveKeywords, localNames, titleDf } from './naming';
import { embedCached, type EmbeddingProvider, type LanguageProvider, type NamingGroup } from './providers';
import { CATEGORY_BY_ID, classify } from './taxonomy';
import { recordText } from './text';
import { centroid, cosine } from './vectors';

export interface OrganizeOptions {
  records: TabRecord[];
  /** All records of existing workspaces (any status), used to describe each workspace. */
  workspaceMembers: TabRecord[];
  workspaces: Workspace[];
  embedding: EmbeddingProvider;
  language: LanguageProvider;
  exclusions: string[];
  minGroupSize: number;
  signal?: AbortSignal;
  onProgress?: (stage: string, done?: number, total?: number) => void;
}

interface Draft {
  key: string;
  basis: string;
  name: string;
  existingWorkspaceId: string | null;
  color: GroupColor | null;
  ids: string[];
  confidence: number;
}

export async function buildProposal(opts: OrganizeOptions): Promise<OrganizeProposal & { warnings: string[] }> {
  const warnings: string[] = [];
  const records = opts.records.filter((r) => !matchesAny(r.url, opts.exclusions));
  const excluded = opts.records.length - records.length;
  if (excluded) warnings.push(`${excluded} excluded ${excluded === 1 ? 'tab was' : 'tabs were'} left out.`);
  if (!records.length) {
    return { id: crypto.randomUUID(), createdAt: Date.now(), providerLabel: opts.embedding.label, groups: [], unassigned: [], warnings };
  }
  const t = opts.embedding.thresholds;
  opts.onProgress?.('Reading tabs', 0, records.length);
  const texts = records.map((r) => recordText(r));
  const vectors = await embedCached(
    opts.embedding,
    records.map((r, i) => ({ text: texts[i], url: r.url, domain: r.domain })),
    { signal: opts.signal, onProgress: (d, n) => opts.onProgress?.('Embedding tabs', d, n) },
  );
  const recIndex = new Map(records.map((r, i) => [r.id, i]));

  // 1. Existing workspaces: centroid of their members (plus their name).
  opts.onProgress?.('Matching existing workspaces');
  const wsCentroids: Array<{ ws: Workspace; vec: number[]; categoryId: string | null }> = [];
  for (const ws of opts.workspaces) {
    const members = opts.workspaceMembers.filter((m) => m.workspaceId === ws.id).slice(0, 40);
    const items = [{ text: `${ws.name} ${ws.summary}`.trim() }, ...members.map((m) => ({ text: recordText(m), url: m.url, domain: m.domain }))];
    const vecs = await embedCached(opts.embedding, items, { signal: opts.signal });
    // The workspace name counts as much as a few member tabs.
    const weighted = members.length ? [vecs[0], vecs[0], ...vecs.slice(1)] : [vecs[0]];
    const cat = [...CATEGORY_BY_ID.values()].find((c) => c.name.toLowerCase() === ws.name.toLowerCase());
    wsCentroids.push({ ws, vec: centroid(weighted), categoryId: cat?.id ?? null });
  }

  const drafts = new Map<string, Draft>();
  const placed = new Set<string>();
  const addTo = (key: string, init: () => Draft, id: string, conf: number) => {
    const d = drafts.get(key) ?? init();
    d.ids.push(id);
    d.confidence = Math.max(d.confidence, conf);
    drafts.set(key, d);
    placed.add(id);
  };

  const classes = records.map((r, i) => classify(texts[i], r.url));
  for (const [i, r] of records.entries()) {
    let bestWs: (typeof wsCentroids)[number] | null = null;
    let bestSim = -1;
    for (const w of wsCentroids) {
      let s = cosine(vectors[i], w.vec);
      if (w.categoryId && classes[i]?.id === w.categoryId) s += 0.25;
      if (s > bestSim) {
        bestSim = s;
        bestWs = w;
      }
    }
    if (bestWs && bestSim >= t.match) {
      const w = bestWs.ws;
      addTo(
        'ws:' + w.id,
        () => ({ key: 'ws:' + w.id, basis: 'Similar to this workspace', name: w.name, existingWorkspaceId: w.id, color: w.color, ids: [], confidence: 0 }),
        r.id,
        Math.min(1, bestSim),
      );
    }
  }

  // 2. Confident topics.
  for (const [i, r] of records.entries()) {
    if (placed.has(r.id)) continue;
    const c = classes[i];
    if (!c || c.confidence < 0.45) continue;
    const cat = CATEGORY_BY_ID.get(c.id)!;
    addTo(
      'cat:' + c.id,
      () => ({ key: 'cat:' + c.id, basis: 'Topic', name: cat.name, existingWorkspaceId: null, color: cat.color, ids: [], confidence: 0 }),
      r.id,
      c.confidence,
    );
  }

  // 3. Cluster the rest by similarity.
  opts.onProgress?.('Clustering');
  const rest = records.filter((r) => !placed.has(r.id));
  const restVecs = rest.map((r) => vectors[recIndex.get(r.id)!]);
  const clusters = agglomerative(restVecs, t.cluster);
  const unassigned: string[] = [];
  clusters.forEach((cl, ci) => {
    if (cl.length < opts.minGroupSize) {
      unassigned.push(...cl.map((k) => rest[k].id));
      return;
    }
    const key = `cl:${ci}`;
    drafts.set(key, { key, basis: 'Similar content', name: '', existingWorkspaceId: null, color: null, ids: cl.map((k) => rest[k].id), confidence: 0.5 });
  });

  // Small topic groups that don't reach the minimum size: try to fold into a cluster, else leave unassigned.
  for (const d of [...drafts.values()]) {
    if (d.existingWorkspaceId || d.ids.length >= opts.minGroupSize) continue;
    drafts.delete(d.key);
    unassigned.push(...d.ids);
  }

  // Attach leftovers to the nearest group when they're reasonably close.
  const groupVecs = [...drafts.values()].map((d) => ({ d, vec: centroid(d.ids.map((id) => vectors[recIndex.get(id)!])) }));
  const stillUnassigned: string[] = [];
  for (const id of unassigned) {
    const v = vectors[recIndex.get(id)!];
    let best: (typeof groupVecs)[number] | null = null;
    let bs = -1;
    for (const g of groupVecs) {
      const s = cosine(v, g.vec);
      if (s > bs) {
        bs = s;
        best = g;
      }
    }
    if (best && bs >= t.match) best.d.ids.push(id);
    else stillUnassigned.push(id);
  }

  // 4. Naming.
  opts.onProgress?.('Naming groups');
  const allTitles = records.map((r) => r.title);
  const df = titleDf(allTitles);
  const byId = new Map(records.map((r) => [r.id, r]));
  const draftList = [...drafts.values()].sort((a, b) => b.ids.length - a.ids.length);
  const naming: NamingGroup[] = draftList.map((d) => {
    const recs = d.ids.map((id) => byId.get(id)!).filter(Boolean);
    const domainCounts = new Map<string, number>();
    for (const r of recs) domainCounts.set(r.domain, (domainCounts.get(r.domain) ?? 0) + 1);
    return {
      key: d.key,
      suggestedName: d.name,
      titles: recs.map((r) => r.title),
      domains: [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).map(([dom]) => dom),
      keywords: distinctiveKeywords(recs.map((r) => r.title), df, allTitles.length),
    };
  });
  const names = new Map(naming.map((g) => [g.key, localNames(g)] as const));
  if (opts.language.id !== 'local' && naming.length) {
    try {
      const llm = await opts.language.nameGroups(naming, opts.signal);
      for (const r of llm) {
        const d = drafts.get(r.key);
        // Existing workspaces keep their names; the model only adds a summary.
        if (d?.existingWorkspaceId) names.set(r.key, { name: d.name, summary: r.summary || names.get(r.key)?.summary || '' });
        else names.set(r.key, { name: r.name, summary: r.summary });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      warnings.push(`${opts.language.label} could not name the groups (${(err as Error).message}). Built-in names are shown instead.`);
    }
  }

  // Merge groups that ended up with the same name (or point at the same workspace).
  const merged = new Map<string, ProposedGroup>();
  const usedColors = new Set<GroupColor>();
  for (const d of draftList) {
    const nm = names.get(d.key) ?? { name: d.name || 'Group', summary: '' };
    const sameWs = d.existingWorkspaceId ? null : opts.workspaces.find((w) => w.name.toLowerCase() === nm.name.toLowerCase());
    const existingWorkspaceId = d.existingWorkspaceId ?? sameWs?.id ?? null;
    const mergeKey = existingWorkspaceId ? `ws:${existingWorkspaceId}` : `name:${nm.name.toLowerCase()}`;
    const prev = merged.get(mergeKey);
    if (prev) {
      prev.recordIds.push(...d.ids.filter((id) => !prev.recordIds.includes(id)));
      continue;
    }
    const color =
      sameWs?.color ?? d.color ?? GROUP_COLORS.find((c) => !usedColors.has(c)) ?? GROUP_COLORS[merged.size % GROUP_COLORS.length];
    usedColors.add(color);
    merged.set(mergeKey, {
      id: crypto.randomUUID(),
      name: existingWorkspaceId ? (opts.workspaces.find((w) => w.id === existingWorkspaceId)?.name ?? nm.name) : nm.name,
      summary: nm.summary,
      color,
      recordIds: [...d.ids],
      existingWorkspaceId,
      confidence: d.confidence,
      basis: existingWorkspaceId ? 'Matches existing workspace' : d.basis,
    });
  }
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    providerLabel: opts.language.id === 'local' ? opts.embedding.label : `${opts.embedding.label} + ${opts.language.label}`,
    groups: [...merged.values()].sort((a, b) => b.recordIds.length - a.recordIds.length),
    unassigned: stillUnassigned,
    warnings,
  };
}

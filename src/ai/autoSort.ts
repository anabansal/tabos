// Auto-organize: decides, without asking, where new unsorted tabs belong. Deliberately conservative:
// it only acts on confident matches, because nobody reviews the result before it happens.
//   1. A tab that clearly matches an existing workspace joins it.
//   2. When enough unsorted tabs share a clear topic (Shopping, Coding, …) a workspace is created.
// Runs on the built-in model only, so it never sends anything off the device.

import type { GroupColor, TabRecord, Workspace } from '../shared/types';
import { matchesAny } from '../shared/url';
import { CATEGORIES, CATEGORY_BY_ID, classify, type Classification } from './taxonomy';
import { recordText } from './text';
import { centroid, cosine, localEmbed } from './vectors';

export interface AutoSortInput {
  /** Live tabs that are unsorted or were placed automatically, not yet checked at their current URL. */
  candidates: TabRecord[];
  workspaces: Workspace[];
  /** Records already in workspaces (any status but closed), used to describe each workspace. */
  members: TabRecord[];
  exclusions: string[];
  /** Unsorted tabs on one topic needed before a new workspace is created. */
  minNewGroup: number;
}

export interface AutoSortPlan {
  assign: Array<{ recordId: string; workspaceId: string; reason: string }>;
  create: Array<{ name: string; color: GroupColor; categoryId: string; recordIds: string[] }>;
  /** Every candidate that was evaluated (sorted or not), so it isn't re-evaluated until it navigates. */
  checked: string[];
}

/** Similarity needed to join a workspace with no topic agreement. */
const STRONG_MATCH = 0.5;
/** Similarity needed when the tab's topic matches the workspace's topic. */
const TOPIC_MATCH = 0.28;
const MIN_TOPIC_CONFIDENCE = 0.45;

const categoryForName = (name: string) => CATEGORIES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

export function planAutoSort(input: AutoSortInput): AutoSortPlan {
  const plan: AutoSortPlan = { assign: [], create: [], checked: [] };
  const eligible = input.candidates.filter((r) => /^https?:\/\//.test(r.url) && !matchesAny(r.url, input.exclusions) && r.title.trim());
  plan.checked = input.candidates.map((r) => r.id);
  if (!eligible.length) return plan;

  // Describe each workspace: its name (counted twice) plus up to 40 members.
  const wsInfo = input.workspaces.map((ws) => {
    const members = input.members.filter((m) => m.workspaceId === ws.id).slice(0, 40);
    const nameVec = localEmbed({ text: `${ws.name} ${ws.summary}`.trim() });
    const vecs = members.map((m) => localEmbed({ text: recordText(m), url: m.url, domain: m.domain }));
    const cat = categoryForName(ws.name);
    return { ws, vec: centroid([nameVec, nameVec, ...vecs]), categoryId: cat?.id ?? dominantCategory(members), hasMembers: members.length > 0 };
  });

  const leftovers: Array<{ rec: TabRecord; cls: Classification | null }> = [];
  for (const rec of eligible) {
    const text = recordText(rec);
    const cls = classify(text, rec.url);
    const vec = localEmbed({ text, url: rec.url, domain: rec.domain });
    let best: { id: string; score: number; reason: string } | null = null;
    for (const w of wsInfo) {
      const sim = cosine(vec, w.vec);
      const topicMatch = !!cls && cls.confidence >= MIN_TOPIC_CONFIDENCE && w.categoryId === cls.id;
      // An unambiguous topic (e.g. Stack Overflow → Coding) is enough on its own; a weaker one also needs similar content.
      const ok = (topicMatch && (cls!.confidence >= 0.7 || sim >= TOPIC_MATCH)) || (w.hasMembers && sim >= STRONG_MATCH);
      if (!ok) continue;
      const score = sim + (topicMatch ? 0.25 : 0);
      if (!best || score > best.score) best = { id: w.ws.id, score, reason: topicMatch ? `${cls!.name} topic` : 'similar to its tabs' };
    }
    if (best) {
      if (best.id !== rec.workspaceId) plan.assign.push({ recordId: rec.id, workspaceId: best.id, reason: best.reason });
    } else if (!rec.workspaceId) {
      // Tabs that already sit in a workspace are only moved, never pulled into a brand-new one.
      leftovers.push({ rec, cls });
    }
  }

  // New workspaces only for clear topics with enough tabs.
  const byTopic = new Map<string, TabRecord[]>();
  for (const { rec, cls } of leftovers) {
    if (!cls || cls.confidence < 0.5) continue;
    const list = byTopic.get(cls.id) ?? [];
    list.push(rec);
    byTopic.set(cls.id, list);
  }
  for (const [catId, recs] of byTopic) {
    if (recs.length < input.minNewGroup) continue;
    const cat = CATEGORY_BY_ID.get(catId)!;
    plan.create.push({ name: cat.name, color: cat.color, categoryId: catId, recordIds: recs.map((r) => r.id) });
  }
  return plan;
}

/** Topic most of a workspace's tabs share (if any), so "My stuff" full of GitHub tabs still counts as Coding. */
function dominantCategory(members: TabRecord[]): string | null {
  if (members.length < 2) return null;
  const counts = new Map<string, number>();
  for (const m of members) {
    const c = classify(recordText(m), m.url);
    if (c && c.confidence >= MIN_TOPIC_CONFIDENCE) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] / members.length >= 0.6 ? top[0] : null;
}

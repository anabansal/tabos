import type { TabRecord } from '../../src/shared/types';
import { getDomain, normalizeUrl } from '../../src/shared/url';

let seq = 0;

export function rec(url: string, title: string, over: Partial<TabRecord> = {}): TabRecord {
  seq++;
  const now = over.lastActiveAt ?? Date.now();
  return {
    id: over.id ?? `r${seq}`,
    chromeTabId: seq,
    windowId: 1,
    index: seq,
    url,
    normalizedUrl: normalizeUrl(url),
    title,
    favIconUrl: '',
    domain: getDomain(url),
    status: 'open',
    workspaceId: null,
    pinned: false,
    audible: false,
    muted: false,
    active: false,
    groupId: -1,
    isProtected: false,
    createdAt: now,
    lastActiveAt: now,
    updatedAt: now,
    activations: 1,
    sleptAt: null,
    archivedAt: null,
    archiveReason: null,
    closedAt: null,
    closeReason: null,
    restoreHint: null,
    meta: null,
    ...over,
  };
}

/** A realistic mixed browsing session. */
export function sampleSession(now = Date.now()): TabRecord[] {
  const d = (days: number) => now - days * 86_400_000;
  return [
    rec('https://arxiv.org/abs/2302.09664', 'Semantic Uncertainty: Linguistic Invariances for Uncertainty Estimation in Natural Language Generation', { lastActiveAt: d(8), id: 'semantic-entropy' }),
    rec('https://www.nature.com/articles/s41586-024-07421-0', 'Detecting hallucinations in large language models using semantic entropy | Nature', { lastActiveAt: d(9), id: 'nature-entropy' }),
    rec('https://arxiv.org/abs/1706.03762', 'Attention Is All You Need', { lastActiveAt: d(20) }),
    rec('https://huggingface.co/meta-llama/Llama-3.1-8B', 'meta-llama/Llama-3.1-8B · Hugging Face', { lastActiveAt: d(1) }),
    rec('https://lilianweng.github.io/posts/2023-06-23-agent/', 'LLM Powered Autonomous Agents | Lil\'Log', { lastActiveAt: d(2) }),
    rec('https://github.com/facebook/react/issues/123', 'useEffect cleanup runs twice · Issue #123 · facebook/react', { lastActiveAt: d(0.2) }),
    rec('https://stackoverflow.com/questions/1/how-to-type-props', 'How to type React props in TypeScript - Stack Overflow', { lastActiveAt: d(0.3) }),
    rec('https://developer.mozilla.org/en-US/docs/Web/API/fetch', 'fetch() global function - Web APIs | MDN', { lastActiveAt: d(0.5) }),
    rec('https://vitejs.dev/guide/build', 'Building for Production | Vite', { lastActiveAt: d(1) }),
    rec('https://www.amazon.com/dp/B0C1', 'Sony WH-1000XM5 Wireless Noise Canceling Headphones : Amazon.com', { lastActiveAt: d(3) }),
    rec('https://www.bestbuy.com/site/sony-headphones', 'Sony WH-1000XM5 headphones - Best Buy', { lastActiveAt: d(3) }),
    rec('https://www.flipkart.com/laptop', 'Buy Laptops Online at Best Prices | Flipkart', { lastActiveAt: d(4) }),
    rec('https://canvas.instructure.com/courses/42/assignments/7', 'Assignment 3: Dynamic Programming - CS 161', { lastActiveAt: d(1) }),
    rec('https://www.gradescope.com/courses/1', 'CS 161 Gradescope', { lastActiveAt: d(2) }),
    rec('https://www.coursera.org/learn/machine-learning', 'Machine Learning Specialization | Coursera', { lastActiveAt: d(6) }),
    rec('https://www.ycombinator.com/library/4D-how-to-raise-a-seed-round', 'How to raise a seed round : YC Startup Library', { lastActiveAt: d(5) }),
    rec('https://paulgraham.com/startupideas.html', 'How to Get Startup Ideas', { lastActiveAt: d(5) }),
    rec('https://techcrunch.com/2026/10/01/startup-raises-series-a/', 'AI startup raises $20M Series A | TechCrunch', { lastActiveAt: d(4) }),
    rec('https://www.youtube.com/watch?v=abc', 'Andrej Karpathy: Let\'s build GPT from scratch - YouTube', { lastActiveAt: d(7) }),
  ];
}

import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Gathers discussion-source results for a topic.
 * The SerpApi key stays here — it is never sent to the browser.
 *
 * Returns { sources: RawSource[] }. Claim extraction happens in /api/extract.
 */

interface RawSource {
  id: string;
  title: string;
  url: string;
  site: string;
  snippet: string;
}

const DISCUSSION_SITES = ['reddit.com', 'news.ycombinator.com', 'stackexchange.com', 'lobste.rs', 'forums.macrumors.com'];
const THREAD_CAP = 10; // latency is the enemy of a 3-minute demo

/** Session cache, keyed by normalized query. Survives warm invocations only — that is enough for a demo. */
const cache = new Map<string, { at: number; sources: RawSource[] }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function normalize(topic: string, focus?: string): string {
  return `${topic} ${focus ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function idFor(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return `s${Math.abs(h).toString(36)}`;
}

async function serpapi(params: Record<string, string>, key: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, api_key: key });
  const res = await fetch(`https://serpapi.com/search.json?${qs}`);
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Google Forums API — purpose-built for discussion results, so it leads. */
async function fromForums(query: string, key: string): Promise<RawSource[]> {
  const data = await serpapi({ engine: 'google_forums', q: query }, key);
  const rows: any[] = data.forum_results ?? data.organic_results ?? [];
  return rows.map((r) => {
    const url = r.link ?? r.url ?? '';
    return {
      id: idFor(url),
      title: r.title ?? 'Untitled thread',
      url,
      site: hostOf(url),
      snippet: [r.snippet, ...(r.extensions ?? [])].filter(Boolean).join(' ').slice(0, 600),
    };
  });
}

/** Plain Google Search, biased toward discussion sites — fallback and breadth. */
async function fromSearch(query: string, key: string): Promise<RawSource[]> {
  const biased = `${query} (${DISCUSSION_SITES.map((s) => `site:${s}`).join(' OR ')})`;
  const data = await serpapi({ engine: 'google', q: biased, num: '20' }, key);
  const rows: any[] = data.organic_results ?? [];
  return rows.map((r) => ({
    id: idFor(r.link ?? ''),
    title: r.title ?? 'Untitled thread',
    url: r.link ?? '',
    site: hostOf(r.link ?? ''),
    snippet: (r.snippet ?? '').slice(0, 600),
  }));
}

function dedupe(lists: RawSource[][]): RawSource[] {
  const seen = new Map<string, RawSource>();
  for (const list of lists) {
    for (const s of list) {
      if (!s.url || seen.has(s.id)) continue;
      seen.set(s.id, s);
    }
  }
  return [...seen.values()].slice(0, THREAD_CAP);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST a JSON body with { topic, focus? }.' });
  }

  const { topic, focus } = (req.body ?? {}) as { topic?: string; focus?: string };
  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: 'missing_topic', message: 'Provide a topic to gather opinions about.' });
  }

  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return res.status(503).json({ error: 'no_api_key', message: 'SERPAPI_KEY is not set on the server. Use ?demo=1 for the cached fixture.' });
  }

  const cacheKey = normalize(topic, focus);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return res.status(200).json({ sources: hit.sources, cached: true });
  }

  const query = focus ? `${topic} ${focus}` : topic;
  try {
    // Forums leads; search runs alongside for breadth. One failing does not sink the gather.
    const [forums, search] = await Promise.allSettled([fromForums(query, key), fromSearch(query, key)]);
    const lists = [forums, search]
      .filter((r): r is PromiseFulfilledResult<RawSource[]> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (lists.length === 0) {
      const reason = forums.status === 'rejected' ? String(forums.reason) : 'unknown';
      return res.status(502).json({ error: 'serpapi_failed', message: reason });
    }

    const sources = dedupe(lists);
    if (sources.length === 0) {
      return res.status(200).json({ sources: [], message: 'No discussion threads found for that topic.' });
    }

    cache.set(cacheKey, { at: Date.now(), sources });
    return res.status(200).json({ sources, cached: false });
  } catch (err) {
    return res.status(502).json({ error: 'gather_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

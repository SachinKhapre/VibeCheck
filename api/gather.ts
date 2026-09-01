import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { countUsable, rankSources, shapeRow, type ShapedSource } from './_shape';

/**
 * Gathers discussion-source results for a topic.
 * The SerpApi key stays here — it is never sent to the browser.
 *
 * Credit discipline (free plan is 250 searches/month):
 *   - google_forums runs first, alone. One credit.
 *   - The google fallback only runs if forums came back too thin to work with.
 *   - Every response is cached, on disk in dev, so re-running a topic costs nothing.
 *   - A hard monthly budget refuses calls rather than silently draining the quota.
 *
 * Returns { sources: RawSource[] }. Claim extraction happens in /api/extract.
 */

type RawSource = ShapedSource;

const DISCUSSION_SITES = ['reddit.com', 'news.ycombinator.com', 'stackexchange.com', 'lobste.rs'];
const THREAD_CAP = 10; // latency is the enemy of a 3-minute demo
const MIN_USABLE_RESULTS = 4; // usable discussion-grade rows, not raw count — raw count is always ~10
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Disk cache for local dev — survives restarts, so iterating on the UI costs zero credits. */
const DISK_CACHE = process.env.VERCEL ? null : join(process.cwd(), '.cache', 'serpapi');
const memoryCache = new Map<string, { at: number; sources: RawSource[] }>();

/** Guard against a runaway loop draining the month. Counts live calls, not cache hits. */
const BUDGET = Number(process.env.SERPAPI_BUDGET ?? 200);
let callsThisInstance = 0;

function normalize(topic: string, focus?: string): string {
  return `${topic} ${focus ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function cacheKey(query: string): string {
  return createHash('sha1').update(query).digest('hex').slice(0, 16);
}

function readCache(query: string): RawSource[] | null {
  const key = cacheKey(query);
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.sources;

  if (DISK_CACHE) {
    const file = join(DISK_CACHE, `${key}.json`);
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { at: number; sources: RawSource[] };
        if (Date.now() - parsed.at < CACHE_TTL_MS) {
          memoryCache.set(key, parsed);
          return parsed.sources;
        }
      } catch {
        /* corrupt cache entry is not worth failing the request over */
      }
    }
  }
  return null;
}

function writeCache(query: string, sources: RawSource[]): void {
  const key = cacheKey(query);
  const entry = { at: Date.now(), sources };
  memoryCache.set(key, entry);
  if (DISK_CACHE) {
    try {
      mkdirSync(DISK_CACHE, { recursive: true });
      writeFileSync(join(DISK_CACHE, `${key}.json`), JSON.stringify(entry, null, 2));
    } catch {
      /* cache is an optimization, not a requirement */
    }
  }
}

function idFor(url: string): string {
  return `s${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
}

async function serpapi(params: Record<string, string>, key: string): Promise<any> {
  if (callsThisInstance >= BUDGET) {
    throw new Error(`SerpApi budget of ${BUDGET} calls reached for this instance. Raise SERPAPI_BUDGET or use ?demo=1.`);
  }
  callsThisInstance += 1;
  console.log(`[gather] SerpApi call ${callsThisInstance}/${BUDGET}: ${params.engine} "${params.q}"`);

  const qs = new URLSearchParams({ ...params, api_key: key });
  const res = await fetch(`https://serpapi.com/search.json?${qs}`);
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  if (data?.error) throw new Error(`SerpApi: ${data.error}`);
  return data;
}

/** Google Forums API — purpose-built for discussion results, so it leads and usually stands alone. */
async function fromForums(query: string, key: string): Promise<RawSource[]> {
  const data = await serpapi({ engine: 'google_forums', q: query }, key);
  // google_forums returns `organic_results`, despite the engine name.
  const rows: any[] = data.organic_results ?? data.forum_results ?? [];
  return rows.map((r) => shapeRow(r, idFor)).filter((s): s is RawSource => s !== null);
}

/** Plain Google Search, biased toward discussion sites. Costs a second credit — only when forums was thin. */
async function fromSearch(query: string, key: string): Promise<RawSource[]> {
  const biased = `${query} (${DISCUSSION_SITES.map((s) => `site:${s}`).join(' OR ')})`;
  const data = await serpapi({ engine: 'google', q: biased, num: '20' }, key);
  const rows: any[] = data.organic_results ?? [];
  return rows.map((r) => shapeRow(r, idFor)).filter((s): s is RawSource => s !== null);
}

function dedupe(lists: RawSource[][]): RawSource[] {
  const seen = new Map<string, RawSource>();
  for (const list of lists) {
    for (const s of list) {
      if (!s.url || seen.has(s.id)) continue;
      seen.set(s.id, s);
    }
  }
  return rankSources([...seen.values()]).slice(0, THREAD_CAP);
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
    return res
      .status(503)
      .json({ error: 'no_api_key', message: 'SERPAPI_KEY is not set on the server. Use ?demo=1 for the cached fixture.' });
  }

  const query = normalize(topic, focus);
  const cached = readCache(query);
  if (cached) return res.status(200).json({ sources: cached, cached: true, credits: 0 });

  try {
    // Forums alone is usually enough, and it is the cheaper path.
    const forums = await fromForums(query, key);
    let sources = dedupe([forums]);
    let credits = 1;

    if (countUsable(sources) < MIN_USABLE_RESULTS) {
      try {
        const search = await fromSearch(query, key);
        sources = dedupe([forums, search]);
        credits = 2;
      } catch (err) {
        // Forums results still stand on their own; do not fail the gather over the fallback.
        console.warn('[gather] fallback search failed', err);
      }
    }

    if (sources.length === 0) {
      return res.status(200).json({ sources: [], credits, message: 'No discussion threads found for that topic.' });
    }

    writeCache(query, sources);
    return res.status(200).json({ sources, cached: false, credits });
  } catch (err) {
    return res.status(502).json({ error: 'gather_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

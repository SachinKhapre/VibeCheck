/**
 * Turns a raw SerpApi response (saved from the playground) into a warm cache entry
 * for /api/gather, so the live path serves real data without spending a credit.
 *
 *   node scripts/seed-cache.mjs "is the dell xps 14 good for dev work?" raw/xps.json
 *
 * The query string must match what the app will send: `topic` plus a space and
 * `focus` if there is one. It is normalized here the same way the API normalizes it.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [rawQuery, file] = process.argv.slice(2);
if (!rawQuery || !file) {
  console.error('usage: node scripts/seed-cache.mjs "<topic [focus]>" <path-to-serpapi-response.json>');
  process.exit(1);
}

const THREAD_CAP = 10;
const CACHE_DIR = join(process.cwd(), '.cache', 'serpapi');

const normalize = (q) => q.toLowerCase().replace(/\s+/g, ' ').trim();
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
};
const idFor = (url) => `s${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;

const data = JSON.parse(readFileSync(file, 'utf8'));
const rows = data.forum_results ?? data.organic_results ?? [];
if (!Array.isArray(rows) || rows.length === 0) {
  console.error(`No forum_results or organic_results in ${file}. Keys present: ${Object.keys(data).join(', ')}`);
  process.exit(1);
}

const seen = new Map();
for (const r of rows) {
  const url = r.link ?? r.url ?? '';
  if (!url) continue;
  const id = idFor(url);
  if (seen.has(id)) continue;
  seen.set(id, {
    id,
    title: r.title ?? 'Untitled thread',
    url,
    site: hostOf(url),
    snippet: [r.snippet, ...(r.extensions ?? [])].filter(Boolean).join(' ').slice(0, 600),
  });
}

const sources = [...seen.values()].slice(0, THREAD_CAP);
const query = normalize(rawQuery);
const key = createHash('sha1').update(query).digest('hex').slice(0, 16);

mkdirSync(CACHE_DIR, { recursive: true });
const out = join(CACHE_DIR, `${key}.json`);
writeFileSync(out, JSON.stringify({ at: Date.now(), sources }, null, 2));

console.log(`Seeded ${sources.length} sources for "${query}"`);
console.log(`  -> ${out}`);
console.log(`\nSites: ${[...new Set(sources.map((s) => s.site))].join(', ')}`);
const thin = sources.filter((s) => s.snippet.length < 80).length;
if (thin) console.log(`Note: ${thin}/${sources.length} snippets are under 80 chars — extraction may struggle.`);

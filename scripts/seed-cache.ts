/**
 * Turns a raw SerpApi response (saved from the playground) into a warm cache entry
 * for /api/gather, so the live path serves real data without spending a credit.
 *
 *   node scripts/seed-cache.ts "is the dell xps 14 good for dev work?" raw/1-demo.json
 *   node scripts/seed-cache.ts --report raw/1-demo.json
 *
 * The query must match what the app will send: `topic`, plus a space and `focus`
 * if there is one. It is normalized here exactly as the API normalizes it.
 *
 * Shaping is imported from api/_shape.ts so a seeded entry is identical to a live one.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countUsable, rankSources, shapeRow, type ShapedSource } from '../api/_shape.ts';

const args = process.argv.slice(2);
const reportOnly = args[0] === '--report';
const [rawQuery, file] = reportOnly ? [null, args[1]] : args;

if (!file || (!reportOnly && !rawQuery)) {
  console.error('usage: node scripts/seed-cache.ts "<topic [focus]>" <response.json>');
  console.error('       node scripts/seed-cache.ts --report <response.json>');
  process.exit(1);
}

const THREAD_CAP = 10;
const CACHE_DIR = join(process.cwd(), '.cache', 'serpapi');

const idFor = (url: string) => `s${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;

const data = JSON.parse(readFileSync(file, 'utf8'));
const rows = data.organic_results ?? data.forum_results ?? [];
if (!Array.isArray(rows) || rows.length === 0) {
  console.error(`No results in ${file}. Keys present: ${Object.keys(data).join(', ')}`);
  process.exit(1);
}

const seen = new Map<string, ShapedSource>();
for (const row of rows) {
  const shaped = shapeRow(row, idFor);
  if (shaped && !seen.has(shaped.id)) seen.set(shaped.id, shaped);
}
const sources = rankSources([...seen.values()]).slice(0, THREAD_CAP);

const usable = countUsable(sources);
console.log(`\n${file} — ${data.search_parameters?.q ?? '?'}`);
console.log(`  ${sources.length} sources, ${usable} usable discussion-grade (fallback fires below 4)\n`);
for (const s of sources) {
  const flags = [s.tier === 'low-signal' ? 'low-signal' : null, s.usable ? null : 'unusable'].filter(Boolean).join(',');
  const meta = [s.engagement ? `${s.engagement}+` : null, s.age].filter(Boolean).join(' · ');
  console.log(`  ${s.usable && s.tier === 'discussion' ? '+' : '-'} ${s.provenance.padEnd(38).slice(0, 38)} ${(meta || '—').padEnd(22)} ${flags}`);
  console.log(`      ${s.title.slice(0, 84)}`);
}

if (reportOnly) process.exit(0);

const query = rawQuery!.toLowerCase().replace(/\s+/g, ' ').trim();
const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
mkdirSync(CACHE_DIR, { recursive: true });
const out = join(CACHE_DIR, `${key}.json`);
writeFileSync(out, JSON.stringify({ at: Date.now(), sources }, null, 2));
console.log(`\nSeeded "${query}"\n  -> ${out}`);

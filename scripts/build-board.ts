/**
 * Turns a raw SerpApi response into a recorded board for the home-page gallery.
 *
 *   node --env-file=.env scripts/build-board.ts <slug> "<topic>" <raw.json> "<blurb>"
 *
 * Costs no SerpApi credit — the search already happened and is saved under raw/.
 * Extraction is the real one: this imports buildPrompt/callOpenRouter/shapeExtraction
 * straight out of api/extract.ts, so a recorded board is shaped exactly like a live
 * gather. Nothing here writes claims by hand.
 *
 * Output goes to src/fixtures/<slug>.json and is bundled, so the gallery works with
 * no keys, no network, and no quota.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rankSources, shapeRow, type ShapedSource } from '../api/_shape.ts';
import { buildPrompt, callOpenRouter, shapeExtraction } from '../api/extract.ts';

const [slug, topic, file, blurb] = process.argv.slice(2);
if (!slug || !topic || !file) {
  console.error('usage: node --env-file=.env scripts/build-board.ts <slug> "<topic>" <raw.json> "<blurb>"');
  process.exit(1);
}

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY is not set. Pass --env-file=.env.');
  process.exit(1);
}

// Same cap the live gather uses.
const THREAD_CAP = 18;
const idFor = (url: string) => `s${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;

const data = JSON.parse(readFileSync(file, 'utf8'));
const rows = data.organic_results ?? data.forum_results ?? [];
if (!Array.isArray(rows) || rows.length === 0) {
  console.error(`No results in ${file}.`);
  process.exit(1);
}

const seen = new Map<string, ShapedSource>();
for (const row of rows) {
  const shaped = shapeRow(row, idFor);
  if (shaped && !seen.has(shaped.id)) seen.set(shaped.id, shaped);
}
const shaped = rankSources([...seen.values()]).slice(0, THREAD_CAP);
console.log(`${file} — ${shaped.length} sources shaped, extracting…`);

const { parsed, model, attempts } = await callOpenRouter(buildPrompt(topic, undefined, shaped), key);
if (attempts.length > 0) console.warn('fell back past:', attempts.join('; '));
const { claims, kept, dropped } = shapeExtraction(parsed, shaped);

const stances = new Map(kept.map((s) => [s.id, s.stance]));
// Only the fields the board reads — `usable` and `ageMonths` are shaping internals.
const sources = shaped
  .filter((s) => stances.has(s.id))
  .map((s) => ({
    id: s.id,
    title: s.title,
    url: s.url,
    site: s.site,
    provenance: s.provenance,
    snippet: s.snippet,
    tier: s.tier,
    ...(s.engagement ? { engagement: s.engagement } : {}),
    ...(s.age ? { age: s.age } : {}),
    stance: stances.get(s.id),
    verdict: 'neutral',
  }));

const board = {
  slug,
  topic,
  blurb: blurb ?? '',
  recordedAt: new Date().toISOString().slice(0, 10),
  note: `Real SerpApi ${data.search_parameters?.engine ?? 'google_forums'} response, shaped by api/_shape.ts. Claims extracted by ${model}.`,
  sources,
  claims,
};

const out = join(process.cwd(), 'src', 'fixtures', `${slug}.json`);
writeFileSync(out, JSON.stringify(board, null, 2) + '\n');

console.log(`\n${claims.length} claims, ${sources.length} sources kept, ${dropped.length} dropped (${model})`);
for (const c of claims) console.log(`  - ${c.text}  [${c.evidence.length}]`);
console.log(`\n-> ${out}`);

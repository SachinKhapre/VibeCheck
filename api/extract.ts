import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import type { ShapedSource } from './_shape';

/**
 * Turns gathered thread snippets into clustered claims.
 *
 * Three jobs, in one call:
 *   1. Relevance — google_forums drifts badly. A query about the XPS 14 returns
 *      threads about the XPS 8910 desktop and a 2012 Inspiron. Those get dropped.
 *   2. Stance — does this read as someone who owns the thing, or someone relaying?
 *   3. Clustering — the recurring points, each tied to the sources that support it.
 *
 * Runs through OpenRouter so it works on a free model. Free models are rate
 * limited and come and go, so MODELS is a fallback chain rather than one id, and
 * the response is validated rather than trusted — see parseExtraction.
 */

// Vercel's default is short; extraction over ten snippets can outrun it.
export const maxDuration = 60;

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Free models that support strict json_schema output, best first. Override with OPENROUTER_MODEL. */
const DEFAULT_MODELS = [
  'z-ai/glm-5.2:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

const MODELS = (process.env.OPENROUTER_MODEL ?? DEFAULT_MODELS.join(','))
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

export const Extraction = z.object({
  sources: z.array(
    z.object({
      id: z.string().describe('The source id exactly as given.'),
      relevant: z.boolean().describe('False if the thread is not actually about the topic.'),
      dropReason: z.string().describe('If not relevant, a short reason. Empty string otherwise.'),
      stance: z
        .enum(['owner', 'secondhand'])
        .describe('owner = speaks from hands-on use. secondhand = relaying, recommending, or asking.'),
    }),
  ),
  claims: z.array(
    z.object({
      id: z.string().describe('Short slug, e.g. "c1".'),
      text: z
        .string()
        .describe('The recurring point, as a plain sentence in the third person. No hedging preamble.'),
      polarity: z.enum(['positive', 'negative', 'mixed']),
      tags: z.array(z.string()).describe('2-5 lowercase keywords for filtering, e.g. "battery", "price".'),
      contestedBy: z
        .string()
        .describe('Id of a claim in this same list that directly contradicts this one, or empty string.'),
      evidence: z.array(
        z.object({
          sourceId: z.string().describe('Must be one of the given source ids.'),
          line: z.string().describe('One short paraphrase of what this source contributes. Never quote verbatim.'),
        }),
      ),
    }),
  ),
});

type Parsed = z.infer<typeof Extraction>;

const JSON_SCHEMA = (() => {
  const schema = z.toJSONSchema(Extraction, { target: 'draft-2020-12' }) as Record<string, unknown>;
  delete schema.$schema; // OpenRouter rejects the meta-schema key on some providers
  return schema;
})();

const SYSTEM = `You read discussion threads and report what people actually said.

WHAT COUNTS AS A CLAIM
- A claim is a substantive statement about the thing being decided on: what it is good at, what it is bad at, what surprised people, what it costs.
- A thread where somebody asks a question is not a claim. "Someone was considering buying it" tells the reader nothing. Leave such threads unused — still marked relevant — rather than inventing a claim from them.
- One source saying one sentence is one claim. If that sentence names both an upside and a downside, that is a single claim with polarity "mixed" — never split it into a positive claim and a negative claim.
- Prefer claims that more than one source touches. A board of three well-supported claims beats seven thin ones. Do not pad.

EVIDENCE LINES
- Write every evidence line in your own words. If your line reuses a distinctive phrase from the snippet, rewrite it until it does not.
- Never copy a snippet, or a clause of one, verbatim. This matters for copyright and it reads badly.
- Say what that specific source contributes to the claim, in one short line.

RELEVANCE — this is a separate question from whether you can draw a claim from it
- Relevant means the thread could inform this decision. Keep anything where people discuss the thing itself, the product line it belongs to, or living with it day to day. Keep threads that are relevant but yield no claim; not every kept source has to appear in the claims.
- Mark not relevant only for a clear mismatch: a different product, a different category (a desktop when the question is about a laptop), a different market or country, or a thread that merely name-drops the thing while discussing something else.
- A thread being a question, being old, or being thin is NOT grounds for marking it irrelevant. Those are reasons it may not support a claim. Keep it and leave it out of the claims.
- When you are unsure, keep it. The reader decides what to trust; your job is not to prune the evidence for them.

STANCE
- "owner" means the person speaks from hands-on use of the thing itself.
- Someone asking for recommendations is secondhand. So is a spec summary, a roundup, and anyone relaying what they have read. When in doubt, secondhand.

FORMAT
- tags: 2 to 5 single lowercase words. No hyphens, no multi-word phrases. These are matched against what the reader types, so use the words a person would actually say: price, battery, ports, linux, build, screen.
- If two claims genuinely conflict, set contestedBy on the stronger one to the id of the weaker one. Otherwise leave it an empty string. Never point a claim at itself.
- Every evidence entry must cite a source id from the input. Do not invent ids.
- Return only the JSON object. No prose, no explanation, no markdown fences.`;

/**
 * Free models honour json_schema unevenly — some wrap the object in fences, some
 * prepend a sentence. Recover what we can before validating.
 */
export function parseExtraction(raw: string): Parsed {
  let text = raw.trim();

  // ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  // Fall back to the outermost braces if there is chatter around the object.
  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }

  return Extraction.parse(JSON.parse(text));
}

/**
 * Reconciles what the model said against what was actually sent.
 * Ids from a model are a suggestion, never a fact — everything here is a guard.
 */
export function shapeExtraction(parsed: Parsed, sources: ShapedSource[]) {
  const given = new Set(sources.map((s) => s.id));
  const assessed = new Map(parsed.sources.filter((s) => given.has(s.id)).map((s) => [s.id, s]));

  // A source the model simply failed to mention has not been judged off-topic — it has
  // not been judged at all. Keep it, unowned, rather than making a thread disappear
  // with no reason next to it.
  const kept = sources
    .filter((s) => assessed.get(s.id)?.relevant !== false)
    .map((s) => ({ id: s.id, stance: assessed.get(s.id)?.stance ?? ('secondhand' as const) }));
  const keptIds = new Set(kept.map((s) => s.id));

  const dropped = [...assessed.values()]
    .filter((s) => !s.relevant)
    .map((s) => ({ id: s.id, reason: s.dropReason }));

  const claimIds = new Set(parsed.claims.map((c) => c.id));
  const claims = parsed.claims
    .map((c) => ({
      id: c.id,
      text: c.text,
      polarity: c.polarity,
      tags: c.tags,
      pinned: false,
      // A claim may only contest another real claim, and never itself.
      contestedBy:
        c.contestedBy && c.contestedBy !== c.id && claimIds.has(c.contestedBy) ? c.contestedBy : undefined,
      evidence: c.evidence.filter((e) => keptIds.has(e.sourceId)),
    }))
    // A claim whose every source was dropped has nothing left holding it up.
    .filter((c) => c.evidence.length > 0);

  return { claims, kept, dropped };
}

export function buildPrompt(topic: string, focus: string | undefined, sources: ShapedSource[]): string {
  // Only the fields the model needs to judge. Ids are what tie the answer back to the board.
  const brief = sources.map((s) => ({
    id: s.id,
    source: s.provenance,
    title: s.title,
    snippet: s.snippet,
    engagement: s.engagement ?? null,
    age: s.age ?? null,
  }));

  return `The person is deciding: "${topic}"${focus ? `\nThey care specifically about: ${focus}` : ''}

Here are the discussion threads that came back:

${JSON.stringify(brief, null, 2)}`;
}

interface CallResult {
  parsed: Parsed;
  model: string;
  /** Models that failed before this one answered. Surfaced so a silent fallback is visible. */
  attempts: string[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Walks the model chain, so one rate-limited free model does not sink the gather. */
export async function callOpenRouter(prompt: string, key: string): Promise<CallResult> {
  const failures: string[] = [];

  for (const model of MODELS) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'x-title': 'Sift',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 4000,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'extraction', strict: true, schema: JSON_SCHEMA },
          },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt },
          ],
        }),
      });

      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        failures.push(`${model}: ${res.status} ${body?.error?.message ?? ''}`.trim());
        continue;
      }

      const content: string | undefined = body?.choices?.[0]?.message?.content;
      if (!content) {
        failures.push(`${model}: empty response`);
        continue;
      }

      return { parsed: parseExtraction(content), model, usage: body?.usage, attempts: failures };
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`every extraction model failed — ${failures.join('; ')}`);
}

interface ExtractBody {
  topic?: string;
  focus?: string;
  sources?: ShapedSource[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed', message: 'POST { topic, sources }.' });
  }

  const { topic, focus, sources } = (req.body ?? {}) as ExtractBody;
  if (!topic?.trim()) {
    return res.status(400).json({ error: 'missing_topic', message: 'Provide the topic the threads were gathered for.' });
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ error: 'missing_sources', message: 'Provide the gathered sources to extract from.' });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return res.status(503).json({
      error: 'no_api_key',
      message: 'OPENROUTER_API_KEY is not set on the server. Use ?demo=1 for the recorded board.',
    });
  }

  try {
    const { parsed, model, usage, attempts } = await callOpenRouter(buildPrompt(topic, focus, sources), key);
    if (attempts.length > 0) console.warn('[extract] fell back:', attempts.join('; '));
    const { claims, kept, dropped } = shapeExtraction(parsed, sources);

    return res.status(200).json({
      claims,
      sources: kept,
      dropped,
      model,
      usage,
    });
  } catch (err) {
    return res.status(502).json({ error: 'extract_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

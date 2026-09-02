import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
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
 * Output is schema-constrained, so there is no JSON to repair and no fences to strip.
 */

// Vercel's default is short; extraction over ten snippets can outrun it.
export const maxDuration = 60;

const MODEL = 'claude-opus-5';

const Extraction = z.object({
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

const SYSTEM = `You read discussion threads and report what people actually said.

Rules:
- Paraphrase. Never reproduce a post verbatim — both for copyright and because quotes make a worse board.
- Only assert what the snippets support. You are given short search snippets, not full threads, so stay close to them and do not infer detail that isn't there.
- Be strict about relevance. Search results drift: a query about one product returns threads about a different model, a different product line, or a different country. Mark those not relevant and say why in one clause.
- A thread where someone is asking for recommendations is secondhand, not an owner, even when it is on-topic.
- Cluster into 3 to 7 claims. A claim is something more than one source touches, or one thing a source says with real specificity. Do not pad the list.
- If two claims genuinely conflict, set contestedBy on the stronger one to the id of the weaker one. Leave it as an empty string otherwise. Never point a claim at itself.
- Every evidence entry must cite a source id from the input. Do not invent ids.`;


type Parsed = z.infer<typeof Extraction>;

/**
 * Reconciles what the model said against what was actually sent.
 * Ids from a model are a suggestion, never a fact — everything here is a guard.
 */
export function shapeExtraction(parsed: Parsed, sources: ShapedSource[]) {
  const given = new Set(sources.map((s) => s.id));

  const kept = parsed.sources.filter((s) => s.relevant && given.has(s.id));
  const keptIds = new Set(kept.map((s) => s.id));
  const dropped = parsed.sources
    .filter((s) => !s.relevant && given.has(s.id))
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'no_api_key',
      message: 'ANTHROPIC_API_KEY is not set on the server. Use ?demo=1 for the recorded board.',
    });
  }

  // Only the fields the model needs to judge. Ids are what tie the answer back to the board.
  const brief = sources.map((s) => ({
    id: s.id,
    source: s.provenance,
    title: s.title,
    snippet: s.snippet,
    engagement: s.engagement ?? null,
    age: s.age ?? null,
  }));

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium', // a 3-minute demo cannot afford a long think over ten snippets
        format: zodOutputFormat(Extraction),
      },
      messages: [
        {
          role: 'user',
          content: `The person is deciding: "${topic}"${focus ? `\nThey care specifically about: ${focus}` : ''}

Here are the discussion threads that came back:

${JSON.stringify(brief, null, 2)}`,
        },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      return res.status(502).json({ error: 'extract_failed', message: 'The model returned no parsable extraction.' });
    }

    const { claims, kept, dropped } = shapeExtraction(parsed, sources);

    return res.status(200).json({
      claims,
      sources: kept.map((s) => ({ id: s.id, stance: s.stance })),
      dropped,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: 'bad_api_key', message: 'ANTHROPIC_API_KEY was rejected.' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'rate_limited', message: 'Extraction is rate limited. Try again shortly.' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: 'extract_failed', message: `Claude API ${err.status}: ${err.message}` });
    }
    return res.status(502).json({ error: 'extract_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

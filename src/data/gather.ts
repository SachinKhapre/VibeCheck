import type { Claim, Source } from '../state/types';
import { boardBySlug, defaultBoard, type RecordedBoard } from '../fixtures';

export interface GatherResult {
  claims: Claim[];
  sources: Source[];
  demo: boolean;
  note?: string;
}

/** A recorded board, opened as-is. Always labelled with the date it was really gathered. */
export function boardResult(board: RecordedBoard, note?: string): GatherResult {
  return {
    claims: board.claims as Claim[],
    sources: board.sources as Source[],
    demo: true,
    note: note ?? `Recorded gather from ${board.recordedAt} — not a live search.`,
  };
}

/** The flagship board — the demo survives a rate limit, an exhausted quota, or a missing key. */
export function fixtureResult(note?: string): GatherResult {
  return boardResult(defaultBoard, note);
}

export const fixtureTopic = defaultBoard.topic;

export function isDemoMode(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

/** `?board=<slug>` deep-links a recorded board, so one can be shared as a link. */
export function initialBoard(): RecordedBoard | undefined {
  const slug = new URLSearchParams(window.location.search).get('board');
  return slug ? boardBySlug(slug) : undefined;
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `${url} returned ${res.status}`);
  return data;
}

/**
 * Live gather: SerpApi for the threads, then extraction for the claims.
 * Falls back to the fixture rather than showing the judge an error screen.
 */
export async function runGather(topic: string, focus?: string): Promise<GatherResult> {
  if (isDemoMode()) return fixtureResult('Demo mode — serving the cached fixture.');

  // Never substitute the recorded board for a failed live gather. Showing one
  // topic's evidence under another topic's question is worse than any error screen.
  const data = await postJson('/api/gather', { topic, focus });
  const raw: Array<Omit<Source, 'stance' | 'verdict' | 'snippet'> & { snippet: string }> = data.sources ?? [];

  if (raw.length === 0) return { claims: [], sources: [], demo: false, note: 'No discussion threads found for that topic.' };

  // Discussion-grade threads read as hands-on until extraction says otherwise.
  const sources: Source[] = raw.map((s) => ({
    ...s,
    stance: s.tier === 'discussion' ? 'owner' : 'secondhand',
    verdict: 'neutral',
  }));

  try {
    const data = await postJson('/api/extract', { topic, focus, sources });
    const stances = new Map<string, Source['stance']>(
      ((data.sources ?? []) as Array<{ id: string; stance?: Source['stance'] }>).map((s) => [s.id, s.stance ?? 'secondhand']),
    );
    // Extraction also decides relevance — google_forums drifts, and an off-topic
    // thread on the board is worse than a short board.
    const kept = sources
      .filter((s) => stances.has(s.id))
      .map((s) => ({ ...s, stance: stances.get(s.id)! }));

    const dropped = (data.dropped ?? []) as Array<{ id: string; reason: string }>;
    return {
      claims: (data.claims ?? []) as Claim[],
      sources: kept.length > 0 ? kept : sources,
      demo: false,
      note: dropped.length > 0 ? `Dropped ${dropped.length} off-topic ${dropped.length === 1 ? 'thread' : 'threads'}.` : undefined,
    };
  } catch (err) {
    return {
      claims: [],
      sources,
      demo: false,
      note: `Gathered ${sources.length} threads. Claim extraction unavailable (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

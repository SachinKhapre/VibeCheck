import type { Claim, Source } from '../state/types';
import fixture from '../fixtures/demo-gather.json';

export interface GatherResult {
  claims: Claim[];
  sources: Source[];
  demo: boolean;
  note?: string;
}

/** Cached fixture — the demo survives a rate limit, an exhausted quota, or a missing key. */
export function fixtureResult(note?: string): GatherResult {
  return {
    claims: fixture.claims as Claim[],
    sources: fixture.sources as Source[],
    demo: true,
    note,
  };
}

export const fixtureTopic = fixture.topic;

export function isDemoMode(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === '1';
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

  let raw: Array<Omit<Source, 'stance' | 'verdict'>>;
  try {
    const data = await postJson('/api/gather', { topic, focus });
    raw = data.sources ?? [];
  } catch (err) {
    return fixtureResult(`Live gather unavailable (${err instanceof Error ? err.message : String(err)}). Showing the cached fixture.`);
  }

  if (raw.length === 0) return { claims: [], sources: [], demo: false, note: 'No discussion threads found for that topic.' };

  const sources: Source[] = raw.map((s) => ({ ...s, stance: 'secondhand', verdict: 'neutral' }));

  try {
    const data = await postJson('/api/extract', { topic, focus, sources });
    const byId = new Map(sources.map((s) => [s.id, s]));
    for (const s of (data.sources ?? []) as Array<{ id: string; stance?: Source['stance'] }>) {
      const existing = byId.get(s.id);
      if (existing && s.stance) existing.stance = s.stance;
    }
    return { claims: (data.claims ?? []) as Claim[], sources, demo: false };
  } catch (err) {
    return {
      claims: [],
      sources,
      demo: false,
      note: `Gathered ${sources.length} threads. Claim extraction unavailable (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

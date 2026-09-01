/**
 * Shapes raw SerpApi google_forums rows into board sources.
 *
 * Shared by /api/gather and scripts/seed-cache.ts so a cache entry seeded from a
 * saved playground response is byte-identical to a live one.
 *
 * Everything here is derived from what google_forums actually returns:
 *   source         "Reddit · r/DellXPS", "Quora", "MacRumors Forums"
 *   displayed_meta "40+ comments · 11 months ago"  (absent about half the time)
 *   snippet        ~150 chars, and sometimes just the title repeated
 */

export type Tier = 'discussion' | 'low-signal';

export interface ShapedSource {
  id: string;
  title: string;
  url: string;
  site: string;
  /** "Reddit · r/DellXPS" when SerpApi gives it, else the hostname. */
  provenance: string;
  snippet: string;
  tier: Tier;
  /** Comments/answers/reactions the thread reports, when it reports any. */
  engagement?: number;
  /** "11 months ago" as returned. */
  age?: string;
  ageMonths?: number;
  /** False when the snippet is empty or just echoes the title — nothing to extract. */
  usable: boolean;
}

/** Sites where people talk to each other. Substring match against SerpApi's `source`. */
const DISCUSSION_MARKERS = [
  'Reddit',
  'Stack Overflow',
  'Stack Exchange',
  'Hacker News',
  'Forums',
  'Forum',
  'Discussion',
  'Community',
  'Lobsters',
  'Ars Technica',
];

/** Sites that answer with SEO filler, self-promotion, or a restated question. */
const LOW_SIGNAL_MARKERS = ['Quora', 'LinkedIn', 'Facebook', 'JustAnswer', 'Medium', 'Pinterest'];

export function tierOf(source: string | undefined, site: string): Tier {
  const haystack = `${source ?? ''} ${site}`;
  if (LOW_SIGNAL_MARKERS.some((m) => haystack.includes(m))) return 'low-signal';
  if (DISCUSSION_MARKERS.some((m) => haystack.includes(m))) return 'discussion';
  // Niche domain forums (TechnoFino, Desidime, Jupiter Community) land here and are
  // usually real discussion, so default to trusting them over the low-signal list.
  return 'discussion';
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A snippet that merely restates the title carries nothing to extract.
 * Quora does this on roughly half its rows.
 */
export function isUsableSnippet(snippet: string, title: string): boolean {
  if (snippet.length < 80) return false;
  const s = norm(snippet);
  const t = norm(title);
  if (!s) return false;
  return !t.includes(s.slice(0, 60));
}

const MONTHS: Record<string, number> = { hour: 0, day: 0, week: 0, month: 1, year: 12 };

/** "40+ comments · 11 months ago" -> { engagement: 40, age: "11 months ago", ageMonths: 11 } */
export function parseMeta(meta: string | undefined): Pick<ShapedSource, 'engagement' | 'age' | 'ageMonths'> {
  if (!meta) return {};
  const out: Pick<ShapedSource, 'engagement' | 'age' | 'ageMonths'> = {};

  const count = meta.match(/(\d+)\+?\s+(comments?|answers?|replies|reactions?)/i);
  if (count) out.engagement = Number(count[1]);

  const age = meta.match(/(\d+)\s+(hour|day|week|month|year)s?\s+ago/i);
  if (age) {
    out.age = `${age[1]} ${age[2]}${Number(age[1]) === 1 ? '' : 's'} ago`;
    const unit = age[2].toLowerCase();
    out.ageMonths = unit === 'week' ? Math.round(Number(age[1]) / 4.3) : Number(age[1]) * (MONTHS[unit] ?? 0);
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function shapeRow(row: any, idFor: (url: string) => string): ShapedSource | null {
  const url: string = row.link ?? row.url ?? '';
  if (!url) return null;

  const title: string = row.title ?? 'Untitled thread';
  const snippet: string = (row.snippet ?? '').trim();
  const site = hostOf(url);
  const source: string | undefined = row.source;

  return {
    id: idFor(url),
    title,
    url,
    site,
    provenance: (source ?? site).replace(/\s*·\s*/g, ' · '),
    snippet: snippet.slice(0, 600),
    tier: tierOf(source, site),
    ...parseMeta(row.displayed_meta),
    usable: isUsableSnippet(snippet, title),
  };
}

/** Discussion-grade first, then by engagement, then by recency. Unusable rows sink. */
export function rankSources(sources: ShapedSource[]): ShapedSource[] {
  return sources.slice().sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    if (a.tier !== b.tier) return a.tier === 'discussion' ? -1 : 1;
    if ((b.engagement ?? 0) !== (a.engagement ?? 0)) return (b.engagement ?? 0) - (a.engagement ?? 0);
    return (a.ageMonths ?? 999) - (b.ageMonths ?? 999);
  });
}

export function countUsable(sources: ShapedSource[]): number {
  return sources.filter((s) => s.usable && s.tier === 'discussion').length;
}

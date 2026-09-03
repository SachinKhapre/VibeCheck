import type { Claim, Source } from '../state/types';
import type { GatherResult } from './gather';

/**
 * Recent gathers, kept in this browser.
 *
 * Two jobs. The obvious one is that the home page stops being a frozen set of
 * recorded boards the moment a live gather works. The quieter one is credit
 * discipline: the whole board is saved, not just the query, so reopening a recent
 * search costs nothing. Re-running it live is a separate, deliberate action.
 *
 * This is per-browser, not cross-user. A genuine "popular" list means counting
 * queries server-side, which needs a shared store the project does not have yet —
 * see the README. The UI here is shaped so that list can slot in beside this one.
 */

const KEY = 'vibecheck-recents-v1';
const MAX = 8;

export interface RecentGather {
  topic: string;
  /** Epoch ms of the gather this was saved from. */
  at: number;
  claims: Claim[];
  sources: Source[];
}

/** Same normalization /api/gather uses for its cache key, so "  Foo  " and "foo" are one entry. */
function normalize(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function loadRecents(): RecentGather[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is RecentGather => Boolean(r?.topic && Array.isArray(r.claims) && Array.isArray(r.sources)));
  } catch {
    // Corrupt or unavailable storage is not worth failing the page over.
    return [];
  }
}

function persist(list: RecentGather[]): RecentGather[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return list;
  } catch {
    // Boards are big and storage is finite. Shed the oldest and try once more before
    // giving up — a failed save must never take the gather down with it.
    if (list.length > 1) return persist(list.slice(0, Math.floor(list.length / 2)));
    return list;
  }
}

/**
 * Saves a live gather. Recorded boards are not saved — they are already on the page,
 * and an empty result is not worth reopening.
 */
export function rememberGather(topic: string, result: GatherResult): RecentGather[] {
  if (result.demo || result.claims.length === 0) return loadRecents();

  const entry: RecentGather = { topic: topic.trim(), at: Date.now(), claims: result.claims, sources: result.sources };
  const key = normalize(entry.topic);
  const next = [entry, ...loadRecents().filter((r) => normalize(r.topic) !== key)].slice(0, MAX);
  return persist(next);
}

export function forgetGather(topic: string): RecentGather[] {
  const key = normalize(topic);
  return persist(loadRecents().filter((r) => normalize(r.topic) !== key));
}

export function clearRecents(): RecentGather[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
  return [];
}

/** A saved board, reopened. Same topic, same evidence — just gathered earlier. */
export function recentResult(recent: RecentGather): GatherResult {
  const when = new Date(recent.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return {
    claims: recent.claims,
    sources: recent.sources,
    demo: false,
    note: `Your gather from ${when}, reopened from this browser.`,
  };
}

export function timeAgo(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

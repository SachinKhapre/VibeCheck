import type { Claim, Source } from '../state/types';
import dellXps14 from './demo-gather.json';
import svelte2026 from './svelte-2026.json';
import bankFreelancers from './bank-freelancers.json';

/**
 * Recorded boards — real gathers, saved.
 *
 * Each one is a real SerpApi response shaped by api/_shape.ts, with claims from the
 * same extraction the live path runs (scripts/build-board.ts). They are bundled, so
 * the gallery costs no credits, needs no keys, and cannot fail.
 *
 * They are never presented as live: `demo` is set on the board, the ledger shows the
 * "recorded gather" badge, and every card carries the date it was gathered.
 */
export interface RecordedBoard {
  slug: string;
  topic: string;
  /** One line of why this board is worth opening. */
  blurb: string;
  /** ISO date the underlying search actually ran. */
  recordedAt: string;
  note: string;
  sources: Source[];
  claims: Claim[];
}

/** Flagship first — it is the deepest board and the one `?demo=1` opens. */
export const recordedBoards: RecordedBoard[] = [dellXps14, svelte2026, bankFreelancers] as RecordedBoard[];

export const defaultBoard = recordedBoards[0];

export function boardBySlug(slug: string): RecordedBoard | undefined {
  return recordedBoards.find((b) => b.slug === slug);
}

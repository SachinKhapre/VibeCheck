import type { BoardState, Claim, Source, Support, Verdict } from './types';

export const emptyBoard: BoardState = {
  topic: '',
  status: 'empty',
  demo: false,
  claims: [],
  sources: {},
  constraints: [],
  lastUpdated: 0,
};

export type Action =
  | { type: 'gather:start'; topic: string; focus?: string }
  | { type: 'gather:success'; claims: Claim[]; sources: Source[]; demo: boolean }
  | { type: 'gather:error'; error: string }
  | { type: 'source:mark'; sourceId: string; verdict: Verdict; reason?: string }
  | { type: 'claim:pin'; claimId: string; pinned: boolean }
  | { type: 'board:constrain'; constraint: string }
  | { type: 'board:clearConstraints' };

export function reducer(state: BoardState, action: Action): BoardState {
  const now = Date.now();
  switch (action.type) {
    case 'gather:start':
      return { ...state, topic: action.topic, focus: action.focus, status: 'gathering', error: undefined, lastUpdated: now };

    case 'gather:success': {
      // Pinned claims and existing verdicts survive a re-gather.
      const pinned = state.claims.filter((c) => c.pinned);
      const keptIds = new Set(pinned.map((c) => c.id));
      const sources: Record<string, Source> = { ...state.sources };
      for (const s of action.sources) {
        const prior = sources[s.id];
        sources[s.id] = prior ? { ...s, verdict: prior.verdict, reason: prior.reason } : s;
      }
      const claims = [...pinned, ...action.claims.filter((c) => !keptIds.has(c.id))];
      return { ...state, status: 'ready', error: undefined, demo: action.demo, claims, sources, lastUpdated: now };
    }

    case 'gather:error':
      return { ...state, status: 'error', error: action.error, lastUpdated: now };

    case 'source:mark': {
      const source = state.sources[action.sourceId];
      if (!source) return state;
      return {
        ...state,
        sources: { ...state.sources, [action.sourceId]: { ...source, verdict: action.verdict, reason: action.reason } },
        lastUpdated: now,
      };
    }

    case 'claim:pin':
      return {
        ...state,
        claims: state.claims.map((c) => (c.id === action.claimId ? { ...c, pinned: action.pinned } : c)),
        lastUpdated: now,
      };

    case 'board:constrain': {
      const constraint = action.constraint.trim();
      if (!constraint) return state;
      return {
        ...state,
        constraints: [...state.constraints, constraint],
        claims: state.claims.map((c) => (c.pinned || c.hiddenBy ? c : applyConstraint(c, constraint))),
        lastUpdated: now,
      };
    }

    case 'board:clearConstraints':
      return {
        ...state,
        constraints: [],
        claims: state.claims.map((c) => ({ ...c, hiddenBy: undefined })),
        lastUpdated: now,
      };
  }
}

const STOP_WORDS = new Set([
  'ignore', 'drop', 'skip', 'exclude', 'hide', 'remove', 'anything', 'about', 'only', 'just', 'the', 'a', 'an',
  'and', 'or', 'i', 'dont', "don't", 'do', 'not', 'care', 'want', 'need', 'posts', 'claims', 'from', 'that', 'is',
  'are', 'for', 'me', 'this', 'these', 'all', 'any', 'stuff', 'things', 'talk', 'talking', 'mentions', 'related', 'to',
]);

/** Keyword match against claim text and tags. Deliberately blunt — the user can always clear constraints. */
export function constraintTerms(constraint: string): string[] {
  return constraint
    .toLowerCase()
    .split(/[^a-z0-9'-]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function applyConstraint(claim: Claim, constraint: string): Claim {
  const terms = constraintTerms(constraint);
  if (terms.length === 0) return claim;
  const haystack = `${claim.text} ${claim.tags.join(' ')}`.toLowerCase();
  const hit = terms.some((t) => haystack.includes(t));
  const isNegative = /\b(ignore|drop|skip|exclude|hide|remove|don'?t|not|no)\b/i.test(constraint);
  // "ignore gaming" hides matches; "only battery" hides non-matches.
  const hide = isNegative ? hit : !hit;
  return hide ? { ...claim, hiddenBy: constraint } : claim;
}

export function supportFor(claim: Claim, sources: Record<string, Source>, maxEvidence: number): Support {
  let counted = 0;
  let trusted = 0;
  let rejected = 0;
  let owners = 0;
  for (const e of claim.evidence) {
    const s = sources[e.sourceId];
    if (!s) continue;
    if (s.verdict === 'rejected') {
      rejected += 1;
      continue;
    }
    counted += 1;
    if (s.verdict === 'trusted') trusted += 1;
    if (s.stance === 'owner') owners += 1;
  }
  // A trusted source counts for more; the bar is relative to the widest-backed claim on the board.
  const raw = counted + trusted * 0.5;
  return { counted, trusted, rejected, owners, weight: maxEvidence > 0 ? Math.min(1, raw / maxEvidence) : 0 };
}

export function maxSupportBasis(claims: Claim[], sources: Record<string, Source>): number {
  let max = 1;
  for (const c of claims) {
    let raw = 0;
    for (const e of c.evidence) {
      const s = sources[e.sourceId];
      if (!s || s.verdict === 'rejected') continue;
      raw += s.verdict === 'trusted' ? 1.5 : 1;
    }
    if (raw > max) max = raw;
  }
  return max;
}

export function visibleClaims(state: BoardState): Claim[] {
  const rank = (c: Claim) => (c.pinned ? 0 : 1);
  // Counter-claims render attached to the claim they contest, not as cards of their own.
  const attached = new Set(state.claims.map((c) => c.contestedBy).filter(Boolean) as string[]);
  return state.claims
    .filter((c) => !c.hiddenBy && !attached.has(c.id))
    .slice()
    .sort((a, b) => rank(a) - rank(b) || b.evidence.length - a.evidence.length);
}

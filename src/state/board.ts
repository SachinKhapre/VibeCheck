import type { ActivityEntry, Actor, BoardState, Claim, Source, Standing, Support, Verdict } from './types';

export const emptyBoard: BoardState = {
  topic: '',
  status: 'empty',
  demo: false,
  claims: [],
  sources: {},
  constraints: [],
  activity: [],
  lastUpdated: 0,
};

/** Every action carries who took it, so the activity log is derived, never assembled by hand. */
interface Origin {
  actor: Actor;
  /** The WebMCP tool that ran, when the agent acted. */
  tool?: string;
}

export type Action = Origin &
  (
    | { type: 'gather:start'; topic: string; focus?: string }
    | { type: 'gather:success'; claims: Claim[]; sources: Source[]; demo: boolean }
    | { type: 'gather:error'; error: string }
    | { type: 'source:mark'; sourceId: string; verdict: Verdict; reason?: string }
    | { type: 'claim:pin'; claimId: string; pinned: boolean }
    | { type: 'board:constrain'; constraint: string }
    | { type: 'board:clearConstraints' }
  );

const ACTIVITY_CAP = 40;
let activitySeq = 0;

function log(state: BoardState, action: Action, summary: string, effect?: string): ActivityEntry[] {
  const entry: ActivityEntry = {
    id: (activitySeq += 1),
    at: Date.now(),
    actor: action.actor,
    tool: action.tool,
    summary,
    effect,
  };
  return [entry, ...state.activity].slice(0, ACTIVITY_CAP);
}

export function reducer(state: BoardState, action: Action): BoardState {
  const now = Date.now();
  switch (action.type) {
    case 'gather:start':
      return {
        ...state,
        topic: action.topic,
        focus: action.focus,
        status: 'gathering',
        error: undefined,
        activity: log(state, action, `Gathering opinions on “${action.topic}”`, action.focus && `focus: ${action.focus}`),
        lastUpdated: now,
      };

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
      const lowSignal = action.sources.filter((s) => s.tier === 'low-signal').length;
      return {
        ...state,
        status: 'ready',
        error: undefined,
        demo: action.demo,
        claims,
        sources,
        activity: log(
          state,
          action,
          `Found ${action.sources.length} threads, clustered into ${action.claims.length - attachedClaimIds(action.claims).size} claims`,
          lowSignal > 0 ? `${lowSignal} flagged low signal` : undefined,
        ),
        lastUpdated: now,
      };
    }

    case 'gather:error':
      return {
        ...state,
        status: 'error',
        error: action.error,
        activity: log(state, action, 'Gather failed', action.error),
        lastUpdated: now,
      };

    case 'source:mark': {
      const source = state.sources[action.sourceId];
      if (!source) return state;
      const sources = { ...state.sources, [action.sourceId]: { ...source, verdict: action.verdict, reason: action.reason } };
      const shaken = state.claims.filter((c) => c.evidence.some((e) => e.sourceId === action.sourceId)).length;
      const verb = action.verdict === 'rejected' ? 'Rejected' : action.verdict === 'trusted' ? 'Trusted' : 'Cleared verdict on';
      return {
        ...state,
        sources,
        activity: log(
          state,
          action,
          `${verb} ${source.provenance}`,
          shaken > 0 ? `${shaken} claim${shaken === 1 ? '' : 's'} re-weighted` : undefined,
        ),
        lastUpdated: now,
      };
    }

    case 'claim:pin': {
      const claim = state.claims.find((c) => c.id === action.claimId);
      return {
        ...state,
        claims: state.claims.map((c) => (c.id === action.claimId ? { ...c, pinned: action.pinned } : c)),
        activity: log(state, action, `${action.pinned ? 'Pinned' : 'Unpinned'} “${claim?.text ?? action.claimId}”`),
        lastUpdated: now,
      };
    }

    case 'board:constrain': {
      const constraint = action.constraint.trim();
      if (!constraint) return state;
      const claims = state.claims.map((c) => (c.pinned || c.hiddenBy ? c : applyConstraint(c, constraint)));
      const hid = claims.filter((c) => c.hiddenBy).length - state.claims.filter((c) => c.hiddenBy).length;
      return {
        ...state,
        constraints: [...state.constraints, constraint],
        claims,
        activity: log(state, action, `Applied “${constraint}”`, `${hid} claim${hid === 1 ? '' : 's'} hidden`),
        lastUpdated: now,
      };
    }

    case 'board:clearConstraints':
      return {
        ...state,
        constraints: [],
        claims: state.claims.map((c) => ({ ...c, hiddenBy: undefined })),
        activity: log(state, action, 'Cleared every constraint'),
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

/** What one source is worth to a claim. Rejected is zero; SEO filler counts for little. */
export function weightOf(source: Source): number {
  if (source.verdict === 'rejected') return 0;
  if (source.verdict === 'trusted') return 1.5;
  return source.tier === 'low-signal' ? 0.4 : 1;
}

export function supportFor(claim: Claim, sources: Record<string, Source>, basis: number): Support {
  let counted = 0;
  let trusted = 0;
  let rejected = 0;
  let owners = 0;
  let raw = 0;
  for (const e of claim.evidence) {
    const s = sources[e.sourceId];
    if (!s) continue;
    if (s.verdict === 'rejected') {
      rejected += 1;
      continue;
    }
    counted += 1;
    raw += weightOf(s);
    if (s.verdict === 'trusted') trusted += 1;
    if (s.stance === 'owner') owners += 1;
  }
  return { counted, trusted, rejected, owners, raw, weight: basis > 0 ? Math.min(1, raw / basis) : 0 };
}

/**
 * How the claim stands. Deliberately quality-aware: three Facebook reposts are not
 * a consensus, and saying so would be the kind of laundering this tool exists to stop.
 */
export function standingOf(claim: Claim, sources: Record<string, Source>, contested: boolean): Standing {
  const s = supportFor(claim, sources, 1);
  if (s.counted === 0) return 'unsupported';
  if (contested) return 'contested';
  const solid = claim.evidence.filter((e) => {
    const src = sources[e.sourceId];
    return src && src.verdict !== 'rejected' && src.tier !== 'low-signal';
  }).length;
  if (s.raw >= 2.5 && solid >= 2) return 'consensus';
  if (solid === 0) return 'weak';
  return 'thin';
}

export function maxSupportBasis(claims: Claim[], sources: Record<string, Source>): number {
  let max = 1;
  for (const c of claims) {
    let raw = 0;
    for (const e of c.evidence) {
      const s = sources[e.sourceId];
      if (s) raw += weightOf(s);
    }
    if (raw > max) max = raw;
  }
  return max;
}

/** Counter-claims render attached to the claim they contest, not as cards of their own. */
export function attachedClaimIds(claims: Claim[]): Set<string> {
  return new Set(claims.map((c) => c.contestedBy).filter(Boolean) as string[]);
}

export function visibleClaims(state: BoardState): Claim[] {
  const rank = (c: Claim) => (c.pinned ? 0 : 1);
  const attached = attachedClaimIds(state.claims);
  return state.claims
    .filter((c) => !c.hiddenBy && !attached.has(c.id))
    .slice()
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        supportFor(b, state.sources, 1).raw - supportFor(a, state.sources, 1).raw ||
        b.evidence.length - a.evidence.length,
    );
}

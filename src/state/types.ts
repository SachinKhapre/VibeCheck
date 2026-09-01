// The one state shape. UI and all WebMCP tools read and write this and nothing else.

export type Verdict = 'neutral' | 'trusted' | 'rejected';

export type Stance = 'owner' | 'secondhand';

export type Tier = 'discussion' | 'low-signal';

export interface Source {
  id: string;
  title: string;
  url: string;
  site: string;
  /** "Reddit · r/DellXPS" when SerpApi gives it, else the hostname. */
  provenance: string;
  /** Whether this is somewhere people talk to each other, or SEO filler. */
  tier: Tier;
  /** Comments/answers the thread reports, when it reports any. */
  engagement?: number;
  /** "11 months ago", as SerpApi worded it. */
  age?: string;
  /** Paraphrased, never a verbatim dump of the post. */
  snippet: string;
  stance: Stance;
  verdict: Verdict;
  /** Why the user (or agent, on the user's instruction) marked it. */
  reason?: string;
}

export interface Evidence {
  sourceId: string;
  /** One short paraphrased line of what this source contributes. */
  line: string;
}

export interface Claim {
  id: string;
  text: string;
  polarity: 'positive' | 'negative' | 'mixed';
  /** Keywords used to match natural-language constraints from filter_board. */
  tags: string[];
  evidence: Evidence[];
  /** A claim that directly contests this one, rendered attached to its parent. */
  contestedBy?: string;
  pinned: boolean;
  hiddenBy?: string;
}

export type Status = 'empty' | 'gathering' | 'ready' | 'error';

/** Who did it. The whole point of the board is that both parties act on the same state. */
export type Actor = 'agent' | 'you';

export interface ActivityEntry {
  id: number;
  at: number;
  actor: Actor;
  /** The WebMCP tool name, when an agent did it. */
  tool?: string;
  summary: string;
  /** What it changed on the board, e.g. "2 claims lost support". */
  effect?: string;
}

export interface BoardState {
  topic: string;
  focus?: string;
  status: Status;
  error?: string;
  demo: boolean;
  claims: Claim[];
  sources: Record<string, Source>;
  /** Natural-language constraints the user has stated, newest last. */
  constraints: string[];
  /** Newest first. Rendered live so the human-agent loop is visible on screen. */
  activity: ActivityEntry[];
  lastUpdated: number;
}

export type Standing = 'consensus' | 'contested' | 'thin' | 'weak' | 'unsupported';

export interface Support {
  /** Distinct non-rejected sources backing the claim. */
  counted: number;
  trusted: number;
  rejected: number;
  owners: number;
  /** Quality-weighted total: trusted counts more, low-signal counts less. */
  raw: number;
  /** 0..1 against the best-supported claim on the board. */
  weight: number;
}

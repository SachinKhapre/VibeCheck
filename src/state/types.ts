// The one state shape. UI and all WebMCP tools read and write this and nothing else.

export type Verdict = 'neutral' | 'trusted' | 'rejected';

export type Stance = 'owner' | 'secondhand';

export interface Source {
  id: string;
  title: string;
  url: string;
  site: string;
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
  lastUpdated: number;
}

export interface Support {
  /** Distinct non-rejected sources backing the claim. */
  counted: number;
  trusted: number;
  rejected: number;
  owners: number;
  /** 0..1, drives the support bar's width. */
  weight: number;
}

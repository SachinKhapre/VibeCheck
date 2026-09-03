import { timeAgo, type RecentGather } from '../data/recents';

interface Props {
  recents: RecentGather[];
  /** Reopen the saved board. Free — no search, no extraction. */
  onOpen: (recent: RecentGather) => void;
  /** Run the same topic again, live. Costs credits, so it is its own button. */
  onRerun: (topic: string) => void;
  onForget: (topic: string) => void;
  onClear: () => void;
}

/**
 * What you looked up, in this browser.
 *
 * Opening a row costs nothing — the whole board was saved. Re-running it is a
 * separate control, because that is the one that spends a SerpApi credit.
 */
export function RecentSearches({ recents, onOpen, onRerun, onForget, onClear }: Props) {
  if (recents.length === 0) return null;

  return (
    <section className="recents">
      <header className="recents-head">
        <h2>your recent gathers</h2>
        <p>Saved in this browser. Reopening one costs nothing.</p>
        <button className="link" onClick={onClear}>
          clear all
        </button>
      </header>

      <ul>
        {recents.map((r) => (
          <li key={r.topic}>
            <button className="recent-open" onClick={() => onOpen(r)}>
              <span className="recent-topic">{r.topic}</span>
              <span className="recent-meta">
                <b>{r.claims.length}</b> claims
                <i />
                <b>{r.sources.length}</b> threads
                <i />
                {timeAgo(r.at)}
              </span>
            </button>
            <span className="recent-actions">
              <button className="link" title="Run this search again, live" onClick={() => onRerun(r.topic)}>
                re-gather
              </button>
              <button className="link" title="Forget this search" onClick={() => onForget(r.topic)}>
                forget
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

import type { Source, Verdict } from '../state/types';

interface Props {
  sources: Record<string, Source>;
  onMark: (sourceId: string, verdict: Verdict) => void;
}

/** Rejected sources stay listed and struck through — seeing your own judgment applied is the point. */
export function SourceList({ sources, onMark }: Props) {
  const list = Object.values(sources);
  if (list.length === 0) return null;

  return (
    <aside className="sources">
      <h2>Sources</h2>
      <ul>
        {list.map((s) => (
          <li key={s.id} className={s.verdict}>
            <a href={s.url} target="_blank" rel="noreferrer" className="source-title">
              {s.title}
            </a>
            <span className="meta">
              {s.site} · {s.stance === 'owner' ? 'hands-on' : 'secondhand'}
            </span>
            {s.reason && <span className="reason">{s.reason}</span>}
            <span className="verdict-actions">
              <button className="link" onClick={() => onMark(s.id, s.verdict === 'trusted' ? 'neutral' : 'trusted')}>
                {s.verdict === 'trusted' ? 'trusted' : 'trust'}
              </button>
              <button className="link" onClick={() => onMark(s.id, s.verdict === 'rejected' ? 'neutral' : 'rejected')}>
                {s.verdict === 'rejected' ? 'rejected' : 'reject'}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

import type { Source, Verdict } from '../state/types';

interface Props {
  sources: Record<string, Source>;
  onMark: (sourceId: string, verdict: Verdict) => void;
}

/** Rejected sources stay listed and struck through — seeing your own judgment applied is the point. */
export function SourceList({ sources, onMark }: Props) {
  const list = Object.values(sources);
  if (list.length === 0) return null;

  const discussion = list.filter((s) => s.tier !== 'low-signal');
  const lowSignal = list.filter((s) => s.tier === 'low-signal');

  return (
    <aside className="sources">
      <h2>sources</h2>
      <ul>
        {discussion.map((s) => (
          <SourceRow key={s.id} source={s} onMark={onMark} />
        ))}
      </ul>

      {lowSignal.length > 0 && (
        <>
          <h2 className="low-signal-head">
            low signal <span>{lowSignal.length}</span>
          </h2>
          <ul>
            {lowSignal.map((s) => (
              <SourceRow key={s.id} source={s} onMark={onMark} />
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function SourceRow({ source: s, onMark }: { source: Source; onMark: Props['onMark'] }) {
  const meta = [s.engagement ? `${s.engagement}+ replies` : null, s.age].filter(Boolean).join(' · ');
  return (
    <li className={`${s.verdict} ${s.tier}`}>
      <a href={s.url} target="_blank" rel="noreferrer" className="source-title">
        {s.title}
      </a>
      <span className="meta">
        {s.provenance}
        {meta && <> · {meta}</>}
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
  );
}

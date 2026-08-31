import { useState } from 'react';
import { supportFor } from '../state/board';
import type { Claim, Source, Verdict } from '../state/types';

interface Props {
  claim: Claim;
  counter?: Claim;
  sources: Record<string, Source>;
  basis: number;
  onPin: (pinned: boolean) => void;
  onMark: (sourceId: string, verdict: Verdict) => void;
}

/**
 * The support bar is the signature element: one block per independent voice.
 * Rejecting a source removes its block, and the bar re-weights in place.
 */
export function ClaimCard({ claim, counter, sources, basis, onPin, onMark }: Props) {
  const [open, setOpen] = useState(false);
  const support = supportFor(claim, sources, basis);
  const contested = Boolean(counter);

  return (
    <article className={`claim ${contested ? 'contested' : ''} ${claim.pinned ? 'pinned' : ''}`}>
      <div className="claim-head">
        <p className="claim-text">{claim.text}</p>
        <button className={`pin ${claim.pinned ? 'on' : ''}`} onClick={() => onPin(!claim.pinned)} title="Pin as decision-relevant">
          {claim.pinned ? 'pinned' : 'pin'}
        </button>
      </div>

      <div className="support" style={{ ['--weight' as string]: support.weight }}>
        {claim.evidence.map((e) => {
          const s = sources[e.sourceId];
          const verdict = s?.verdict ?? 'neutral';
          return <span key={e.sourceId} className={`block ${verdict} ${s?.stance ?? 'secondhand'}`} title={s?.title} />;
        })}
      </div>

      <p className="support-line">
        {support.counted} independent {support.counted === 1 ? 'voice' : 'voices'}
        {support.owners > 0 && <> · {support.owners} hands-on</>}
        {support.rejected > 0 && <> · {support.rejected} rejected by you</>}
        <button className="link" onClick={() => setOpen((v) => !v)}>
          {open ? 'hide evidence' : 'evidence'}
        </button>
      </p>

      {open && (
        <ul className="evidence">
          {claim.evidence.map((e) => {
            const s = sources[e.sourceId];
            if (!s) return null;
            return (
              <li key={e.sourceId} className={s.verdict}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.site}
                </a>
                <span className="line">{e.line}</span>
                <span className="verdict-actions">
                  <button className="link" onClick={() => onMark(s.id, s.verdict === 'trusted' ? 'neutral' : 'trusted')}>
                    trust
                  </button>
                  <button className="link" onClick={() => onMark(s.id, s.verdict === 'rejected' ? 'neutral' : 'rejected')}>
                    reject
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {counter && (
        <div className="counter">
          <p className="counter-text">{counter.text}</p>
          <p className="support-line">
            {supportFor(counter, sources, basis).counted} against
          </p>
        </div>
      )}
    </article>
  );
}

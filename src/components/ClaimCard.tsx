import { useState } from 'react';
import { standingOf, supportFor, weightOf } from '../state/board';
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
 * The support bar is the signature element: one segment per independent voice.
 * Rejecting a source collapses its segment, and the bar re-weights in place.
 * It is the only thing on the page allowed to be loud.
 */
export function ClaimCard({ claim, counter, sources, basis, onPin, onMark }: Props) {
  const [open, setOpen] = useState(false);
  const support = supportFor(claim, sources, basis);
  const counterSupport = counter ? supportFor(counter, sources, basis) : null;

  const standing = standingOf(claim, sources, Boolean(counter));

  return (
    <article className={`claim ${standing} ${claim.pinned ? 'pinned' : ''}`}>
      <header className="claim-head">
        <span className={`standing ${standing}`}>{standing}</span>
        <button
          className={`pin ${claim.pinned ? 'on' : ''}`}
          onClick={() => onPin(!claim.pinned)}
          title={claim.pinned ? 'Unpin' : 'Pin as decision-relevant'}
        >
          {claim.pinned ? '★ pinned' : '☆ pin'}
        </button>
      </header>

      <p className="claim-text">{claim.text}</p>

      {/* The bar spans the column in proportion to the best-supported claim on the board,
          and each segment within it is sized by what that one source is worth. */}
      <div className="support-track">
        <div className="support-fill" style={{ width: `${Math.max(support.weight * 100, 3)}%` }}>
          {claim.evidence.map((e) => {
            const s = sources[e.sourceId];
            const verdict = s?.verdict ?? 'neutral';
            return (
              <span
                key={e.sourceId}
                className={`seg ${verdict} ${s?.stance ?? 'secondhand'} ${s?.tier ?? ''}`}
                style={{ flexGrow: s ? Math.max(weightOf(s), 0.08) : 0.08 }}
                title={`${s?.provenance ?? 'unknown'}${s?.tier === 'low-signal' ? ' · low signal' : ''}${
                  verdict !== 'neutral' ? ` — ${verdict} by you` : ''
                }`}
              />
            );
          })}
        </div>
      </div>

      <p className="support-line">
        <strong>{support.counted}</strong> {support.counted === 1 ? 'voice' : 'voices'}
        {support.owners > 0 && <span className="sub"> · {support.owners} hands-on</span>}
        {support.trusted > 0 && <span className="sub trusted"> · {support.trusted} trusted</span>}
        {support.rejected > 0 && <span className="sub struck"> · {support.rejected} rejected</span>}
        <button className="link" onClick={() => setOpen((v) => !v)}>
          {open ? 'hide' : 'evidence'}
        </button>
      </p>

      {open && (
        <ul className="evidence">
          {claim.evidence.map((e) => {
            const s = sources[e.sourceId];
            if (!s) return null;
            return (
              <li key={e.sourceId} className={s.verdict}>
                <a href={s.url} target="_blank" rel="noreferrer" className="ev-source">
                  {s.provenance}
                </a>
                <span className="ev-line">{e.line}</span>
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

      {counter && counterSupport && (
        <div className="counter">
          <span className="counter-label">but</span>
          <div>
            <p className="counter-text">{counter.text}</p>
            <p className="support-line">
              <strong>{counterSupport.counted}</strong> against
            </p>
          </div>
        </div>
      )}
    </article>
  );
}

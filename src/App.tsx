import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { emptyBoard, maxSupportBasis, reducer, visibleClaims } from './state/board';
import { fixtureResult, fixtureTopic, isDemoMode, runGather } from './data/gather';
import { siftTools } from './mcp/siftTools';
import { useTools } from './mcp/useTools';
import { ClaimCard } from './components/ClaimCard';
import { SourceList } from './components/SourceList';
import { ActivityRail } from './components/ActivityRail';

/** Starting points for a cold visitor. The first one is the recorded board, so it always works. */
const SUGGESTIONS = [
  'Is the Framework 13 worth it in 2026?',
  'Which mattress actually holds up after a year?',
  'Is Postgres or SQLite right for a small SaaS?',
];

const HOW = [
  { n: '01', title: 'Ask a real question', body: 'The one you would have typed into Google with “reddit” bolted on the end.' },
  { n: '02', title: 'Read the board, not the threads', body: 'Every claim carries a support bar — one segment per independent voice behind it.' },
  { n: '03', title: 'Judge who to believe', body: 'Reject a shill, trust an owner. Every claim they touched re-weights in place.' },
];

export default function App() {
  const [state, dispatch] = useReducer(reducer, emptyBoard);
  const [draft, setDraft] = useState('');
  const [registered, setRegistered] = useState<string[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('sift-theme') === 'light' ? 'light' : 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sift-theme', theme);
  }, [theme]);

  // The agent gets the same state object the UI renders.
  useTools(siftTools(state, dispatch), setRegistered);

  // A judge opening ?demo=1 cold should land on a full board, not an empty one.
  const autoloaded = useRef(false);
  useEffect(() => {
    if (autoloaded.current || !isDemoMode()) return;
    autoloaded.current = true;
    void gather(fixtureTopic, true);
  }, []);

  const basis = useMemo(() => maxSupportBasis(state.claims, state.sources), [state.claims, state.sources]);
  const claims = visibleClaims(state);
  const hidden = state.claims.filter((c) => c.hiddenBy);
  const sourceCount = Object.keys(state.sources).length;
  const rejected = Object.values(state.sources).filter((s) => s.verdict === 'rejected').length;
  const gathering = state.status === 'gathering';

  async function gather(topic: string, recorded = false) {
    if (!topic.trim()) return;
    setDraft(topic);
    dispatch({ type: 'gather:start', topic, actor: 'you' });
    try {
      const result = recorded ? fixtureResult('Recorded gather — not a live search.') : await runGather(topic);
      dispatch({
        type: 'gather:success',
        claims: result.claims,
        sources: result.sources,
        demo: result.demo,
        note: result.note,
        actor: 'you',
      });
    } catch (err) {
      dispatch({ type: 'gather:error', error: err instanceof Error ? err.message : String(err), actor: 'you' });
    }
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="wordmark">
          sift<span className="dot" />
        </div>
        <div className="agent-status">
          {isDemoMode() && <span className="chip">recorded gather</span>}
          <span className={registered.length > 0 ? 'chip live' : 'chip'} title={registered.join(', ')}>
            {registered.length > 0 ? `agent connected · ${registered.length} tools` : 'connecting agent…'}
          </span>
          <button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color theme">
            <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span> {theme === 'dark' ? 'light' : 'dark'}
          </button>
        </div>
      </header>

      <form
        className="decide"
        onSubmit={(e) => {
          e.preventDefault();
          void gather(draft);
        }}
      >
        <div className="decide-field">
          <span className="glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What are you deciding on?"
            aria-label="What are you deciding on?"
            autoFocus
          />
        </div>
        <button type="submit" disabled={gathering}>
          {gathering && <span className="spin" aria-hidden="true" />}
          {gathering ? 'gathering' : 'sift'}
        </button>
      </form>

      {state.status === 'empty' && (
        <section className="empty">
          <p className="eyebrow">
            <b>webmcp</b> a board you and your agent work on together
          </p>
          <h1 className="lede">
            What people <em>actually</em> said.
          </h1>
          <p className="sub">
            You already do this by hand — you add <strong>reddit</strong> to the search and read threads until a picture
            forms. Sift does the reading. You decide who to believe, and every claim they touched re-weights in front of
            you.
          </p>

          <div className="suggests">
            <span className="label">try</span>
            <button className="suggest primary" onClick={() => void gather(fixtureTopic, true)}>
              {fixtureTopic}
            </button>
            {SUGGESTIONS.map((topic) => (
              <button key={topic} className="suggest" onClick={() => void gather(topic)}>
                {topic}
              </button>
            ))}
          </div>

          <div className="how">
            {HOW.map((step) => (
              <article key={step.n} className="how-step">
                <span className="n">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {state.status === 'error' && (
        <section className="failed">
          <p className="error">Could not gather opinions on “{state.topic}”.</p>
          <p className="reason">{state.error}</p>
          <button className="ghost" onClick={() => void gather(fixtureTopic, true)}>
            Show the recorded board for “{fixtureTopic}” instead
          </button>
        </section>
      )}

      {state.status !== 'empty' && (
        <>
          <div className="ledger">
            <span>
              <strong>{claims.length}</strong> claims
            </span>
            <span>
              <strong>{sourceCount}</strong> threads
            </span>
            {rejected > 0 && (
              <span className="struck">
                <strong>{rejected}</strong> rejected by you
              </span>
            )}
            {state.note && <span className="note">{state.note}</span>}
            {state.demo && <span className="note recorded">recorded gather</span>}
            {state.constraints.map((c, i) => (
              <span key={i} className="constraint">
                {c}
              </span>
            ))}
            {state.constraints.length > 0 && (
              <button className="link" onClick={() => dispatch({ type: 'board:clearConstraints', actor: 'you' })}>
                clear
              </button>
            )}
          </div>

          <main className="board">
            <div className="claims">
              {gathering && claims.length === 0 && (
                <>
                  <p className="gathering-note">
                    <span className="spin" aria-hidden="true" />
                    Reading threads on “{state.topic}”…
                  </p>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skeleton" style={{ ['--stagger' as string]: `${i * 90}ms` }} aria-hidden="true">
                      <div className="sk-line tag" />
                      <div className="sk-line head" />
                      <div className="sk-line head short" />
                      <div className="sk-line bar" />
                      <div className="sk-line foot" />
                    </div>
                  ))}
                </>
              )}

              {claims.map((claim, i) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  index={i}
                  counter={claim.contestedBy ? state.claims.find((c) => c.id === claim.contestedBy) : undefined}
                  sources={state.sources}
                  basis={basis}
                  onPin={(pinned) => dispatch({ type: 'claim:pin', claimId: claim.id, pinned, actor: 'you' })}
                  onMark={(sourceId, verdict) => dispatch({ type: 'source:mark', sourceId, verdict, actor: 'you' })}
                />
              ))}
              {claims.length === 0 && state.status === 'ready' && (
                <p className="error">Nothing left on the board. Clear a constraint or gather a different topic.</p>
              )}
              {hidden.length > 0 && (
                <p className="hidden-note">
                  {hidden.length} claim{hidden.length === 1 ? '' : 's'} hidden by your constraints.
                </p>
              )}
            </div>

            <aside className="rail">
              <ActivityRail activity={state.activity} />
              <SourceList
                sources={state.sources}
                onMark={(sourceId, verdict) => dispatch({ type: 'source:mark', sourceId, verdict, actor: 'you' })}
              />
            </aside>
          </main>
        </>
      )}
    </div>
  );
}

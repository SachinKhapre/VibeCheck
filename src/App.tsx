import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { emptyBoard, maxSupportBasis, reducer, visibleClaims } from './state/board';
import { fixtureTopic, isDemoMode, runGather } from './data/gather';
import { siftTools } from './mcp/siftTools';
import { useTools } from './mcp/useTools';
import { ClaimCard } from './components/ClaimCard';
import { SourceList } from './components/SourceList';
import { ActivityRail } from './components/ActivityRail';

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
    setDraft(fixtureTopic);
    void gather(fixtureTopic);
  }, []);

  const basis = useMemo(() => maxSupportBasis(state.claims, state.sources), [state.claims, state.sources]);
  const claims = visibleClaims(state);
  const hidden = state.claims.filter((c) => c.hiddenBy);
  const sourceCount = Object.keys(state.sources).length;
  const rejected = Object.values(state.sources).filter((s) => s.verdict === 'rejected').length;

  async function gather(topic: string) {
    if (!topic.trim()) return;
    dispatch({ type: 'gather:start', topic, actor: 'you' });
    try {
      const result = await runGather(topic);
      dispatch({
        type: 'gather:success',
        claims: result.claims,
        sources: result.sources,
        demo: result.demo,
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
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What are you deciding on?"
          aria-label="What are you deciding on?"
          autoFocus
        />
        <button type="submit" disabled={state.status === 'gathering'}>
          {state.status === 'gathering' ? 'gathering' : 'sift'}
        </button>
      </form>

      {state.status === 'empty' && (
        <section className="empty">
          <p className="lede">
            You already do this by hand. You add <em>reddit</em> to the search and read threads until a picture forms.
          </p>
          <p className="sub">
            Sift does the reading. You decide who to believe — reject the shills, trust the owners, and watch every
            claim they touched re-weight.
          </p>
          <button className="ghost" onClick={() => void gather(fixtureTopic)}>
            Try “{fixtureTopic}”
          </button>
        </section>
      )}

      {state.status === 'error' && <p className="error">{state.error}</p>}

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
              {claims.map((claim) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
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

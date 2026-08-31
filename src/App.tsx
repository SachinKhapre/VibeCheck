import { useMemo, useReducer, useState } from 'react';
import { emptyBoard, maxSupportBasis, reducer, visibleClaims } from './state/board';
import { fixtureTopic, isDemoMode, runGather } from './data/gather';
import { siftTools } from './mcp/siftTools';
import { useTools } from './mcp/useTools';
import { getModelContext } from './mcp/modelContext';
import { ClaimCard } from './components/ClaimCard';
import { SourceList } from './components/SourceList';

export default function App() {
  const [state, dispatch] = useReducer(reducer, emptyBoard);
  const [draft, setDraft] = useState('');
  const [registered, setRegistered] = useState<string[]>([]);

  // The agent gets the same state object the UI renders.
  useTools(siftTools(state, dispatch), setRegistered);

  const basis = useMemo(() => maxSupportBasis(state.claims, state.sources), [state.claims, state.sources]);
  const claims = visibleClaims(state);
  const hidden = state.claims.filter((c) => c.hiddenBy);

  async function gather(topic: string) {
    if (!topic.trim()) return;
    dispatch({ type: 'gather:start', topic });
    try {
      const result = await runGather(topic);
      dispatch({ type: 'gather:success', claims: result.claims, sources: result.sources, demo: result.demo });
    } catch (err) {
      dispatch({ type: 'gather:error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="wordmark">sift</div>
        <div className="agent-status">
          {getModelContext() ? (
            <span title={registered.join(', ')}>
              agent connected · {registered.length || 6} tools
            </span>
          ) : (
            <span className="warn">no agent — needs HTTPS</span>
          )}
          {isDemoMode() && <span className="demo-chip">demo fixture</span>}
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
          {state.status === 'gathering' ? 'gathering…' : 'sift'}
        </button>
      </form>

      {state.constraints.length > 0 && (
        <div className="constraints">
          {state.constraints.map((c, i) => (
            <span key={i} className="constraint">
              {c}
            </span>
          ))}
          <button className="link" onClick={() => dispatch({ type: 'board:clearConstraints' })}>
            clear
          </button>
        </div>
      )}

      {state.status === 'empty' && (
        <section className="empty">
          <p>
            You already do this by hand — you add <em>reddit</em> to the search and read until a picture forms. Put the
            decision above and Sift gathers what people actually said. You decide who to believe.
          </p>
          <button className="link" onClick={() => void gather(fixtureTopic)}>
            Try it with “{fixtureTopic}”
          </button>
        </section>
      )}

      {state.status === 'error' && <p className="error">{state.error}</p>}

      {state.status !== 'empty' && (
        <main className="board">
          <div className="claims">
            {claims.map((claim) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                counter={claim.contestedBy ? state.claims.find((c) => c.id === claim.contestedBy) : undefined}
                sources={state.sources}
                basis={basis}
                onPin={(pinned) => dispatch({ type: 'claim:pin', claimId: claim.id, pinned })}
                onMark={(sourceId, verdict) => dispatch({ type: 'source:mark', sourceId, verdict })}
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

          <SourceList
            sources={state.sources}
            onMark={(sourceId, verdict) => dispatch({ type: 'source:mark', sourceId, verdict })}
          />
        </main>
      )}
    </div>
  );
}

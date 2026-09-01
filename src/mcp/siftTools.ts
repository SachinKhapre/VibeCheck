import type { Dispatch } from 'react';
import { fail, ok, type ToolDefinition } from './modelContext';
import type { Action } from '../state/board';
import { maxSupportBasis, supportFor, visibleClaims } from '../state/board';
import type { BoardState, Claim } from '../state/types';
import { runGather } from '../data/gather';

/** Every tool reads and writes the same board state the UI renders. */
export function siftTools(state: BoardState, dispatch: Dispatch<Action>): ToolDefinition[] {
  const claimById = (id: string): Claim | undefined => state.claims.find((c) => c.id === id);

  const boardSnapshot = () => {
    const basis = maxSupportBasis(state.claims, state.sources);
    return {
      topic: state.topic,
      focus: state.focus,
      status: state.status,
      demo: state.demo,
      constraints: state.constraints,
      claims: visibleClaims(state).map((c) => {
        const s = supportFor(c, state.sources, basis);
        return {
          id: c.id,
          text: c.text,
          polarity: c.polarity,
          pinned: c.pinned,
          contestedBy: c.contestedBy,
          support: { sources: s.counted, trusted: s.trusted, rejected: s.rejected, owners: s.owners },
          sourceIds: c.evidence.map((e) => e.sourceId),
        };
      }),
      hiddenClaims: state.claims
        .filter((c) => c.hiddenBy)
        .map((c) => ({ id: c.id, text: c.text, hiddenBy: c.hiddenBy })),
      sources: Object.values(state.sources).map((s) => ({
        id: s.id,
        title: s.title,
        site: s.site,
        url: s.url,
        stance: s.stance,
        verdict: s.verdict,
        reason: s.reason,
      })),
    };
  };

  return [
    {
      name: 'gather_opinions',
      description:
        "Searches discussion sources (Reddit, Hacker News, forums) for what real users say about a topic, then clusters what they say into claims and puts them on the user's board. Use this when the user is deciding on something and wants first-hand opinions rather than marketing pages. `focus` narrows the gather, for example 'battery life' or 'after 6 months'.",
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'The thing being decided on, e.g. "Is the Dell XPS 14 good for dev work?"',
          },
          focus: {
            type: 'string',
            description: 'Optional narrowing angle, e.g. "battery life", "after 6 months".',
          },
        },
        required: ['topic'],
      },
      async execute({ topic, focus }: { topic: string; focus?: string }) {
        if (!topic?.trim()) return fail('missing_topic', 'Provide a topic to gather opinions about.');
        dispatch({ type: 'gather:start', topic, focus, actor: 'agent', tool: 'gather_opinions' });
        try {
          const result = await runGather(topic, focus);
          dispatch({
            type: 'gather:success',
            claims: result.claims,
            sources: result.sources,
            demo: result.demo,
            actor: 'agent',
            tool: 'gather_opinions',
          });
          const summary = result.claims.map((c) => `- ${c.text} (${c.evidence.length} sources)`).join('\n');
          return ok(
            `Gathered ${result.sources.length} threads on "${topic}" and put ${result.claims.length} claims on the board.` +
              (result.note ? ` ${result.note}` : '') +
              (summary ? `\n\n${summary}` : ''),
            { claims: result.claims.length, sources: result.sources.length, demo: result.demo, note: result.note },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          dispatch({ type: 'gather:error', error: message, actor: 'agent', tool: 'gather_opinions' });
          return fail('gather_failed', message);
        }
      },
    },

    {
      name: 'get_board',
      description:
        "Returns the current board: every claim with how many independent sources back it, which sources the user has marked trusted or rejected, which claims are pinned, and any constraints the user has applied. Call this before acting so you are working from the user's judgments, not your own assumptions.",
      inputSchema: { type: 'object', properties: {} },
      execute() {
        if (state.status === 'empty') {
          return ok('The board is empty. Call gather_opinions with a topic first.', boardSnapshot());
        }
        const board = boardSnapshot();
        const lines = board.claims.map(
          (c) =>
            `${c.pinned ? '[pinned] ' : ''}${c.text} — ${c.support.sources} sources (${c.support.owners} hands-on, ${c.support.trusted} trusted, ${c.support.rejected} rejected)`,
        );
        return ok(`Board for "${state.topic}":\n${lines.join('\n')}`, board);
      },
    },

    {
      name: 'drill_claim',
      description:
        'Returns the underlying threads and paraphrased evidence lines behind one claim, including sources the user has rejected, so you can judge whether the claim actually holds up. Use claim ids from get_board.',
      inputSchema: {
        type: 'object',
        properties: { claimId: { type: 'string', description: 'Claim id from get_board.' } },
        required: ['claimId'],
      },
      execute({ claimId }: { claimId: string }) {
        const claim = claimById(claimId);
        if (!claim) return fail('unknown_claim', `No claim with id "${claimId}". Call get_board for current ids.`);
        const evidence = claim.evidence.map((e) => {
          const s = state.sources[e.sourceId];
          return {
            sourceId: e.sourceId,
            line: e.line,
            title: s?.title,
            url: s?.url,
            site: s?.site,
            stance: s?.stance,
            verdict: s?.verdict,
          };
        });
        const text = evidence
          .map((e) => `${e.verdict === 'rejected' ? '[rejected] ' : ''}${e.site ?? '?'} — ${e.line} (${e.url ?? 'no url'})`)
          .join('\n');
        return ok(`"${claim.text}"\n${text}`, {
          claim: { id: claim.id, text: claim.text, polarity: claim.polarity },
          evidence,
        });
      },
    },

    {
      name: 'mark_source',
      description:
        "Applies the user's credibility judgment to one source and recomputes how much support every claim resting on it has. Use verdict 'rejected' when the user says a source is a shill, an affiliate listicle, or otherwise junk, and 'trusted' when they vouch for it. Rejected sources stay visible on the board, struck through.",
      inputSchema: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Source id from get_board or drill_claim.' },
          verdict: {
            type: 'string',
            enum: ['trusted', 'rejected', 'neutral'],
            description: "The user's judgment on this source.",
          },
          reason: { type: 'string', description: 'Short reason, shown next to the source on the board.' },
        },
        required: ['sourceId', 'verdict'],
      },
      execute({
        sourceId,
        verdict,
        reason,
      }: {
        sourceId: string;
        verdict: 'trusted' | 'rejected' | 'neutral';
        reason?: string;
      }) {
        const source = state.sources[sourceId];
        if (!source) return fail('unknown_source', `No source with id "${sourceId}". Call get_board for current ids.`);
        if (!['trusted', 'rejected', 'neutral'].includes(verdict)) {
          return fail('bad_verdict', `verdict must be "trusted", "rejected" or "neutral" — got "${verdict}".`);
        }
        dispatch({ type: 'source:mark', sourceId, verdict, reason, actor: 'agent', tool: 'mark_source' });

        // Report support as it will be once the mark lands.
        const projected = { ...state.sources, [sourceId]: { ...source, verdict } };
        const basis = maxSupportBasis(state.claims, projected);
        const affected = state.claims
          .filter((c) => c.evidence.some((e) => e.sourceId === sourceId))
          .map((c) => {
            const s = supportFor(c, projected, basis);
            return { id: c.id, text: c.text, sources: s.counted, rejected: s.rejected };
          });
        const lines = affected.map((a) => `- "${a.text}" now rests on ${a.sources} sources`).join('\n');
        return ok(`Marked the ${source.site} source "${source.title}" as ${verdict}.${lines ? `\n${lines}` : ''}`, {
          sourceId,
          verdict,
          affectedClaims: affected,
        });
      },
    },

    {
      name: 'filter_board',
      description:
        'Applies a constraint the user just stated in plain language, for example "ignore anything about gaming" or "only posts from people who own one". Claims that fall outside the constraint are hidden but not deleted. Pass constraint "clear" to drop every constraint and show the full board again.',
      inputSchema: {
        type: 'object',
        properties: {
          constraint: { type: 'string', description: 'The constraint in the user own words, or "clear".' },
        },
        required: ['constraint'],
      },
      execute({ constraint }: { constraint: string }) {
        if (!constraint?.trim()) return fail('missing_constraint', 'Provide the constraint the user stated.');
        if (constraint.trim().toLowerCase() === 'clear') {
          dispatch({ type: 'board:clearConstraints', actor: 'agent', tool: 'filter_board' });
          return ok('Cleared every constraint. The full board is showing again.');
        }
        dispatch({ type: 'board:constrain', constraint, actor: 'agent', tool: 'filter_board' });
        return ok(`Applied "${constraint}". Call get_board to see what is left.`, { constraint });
      },
    },

    {
      name: 'pin_claim',
      description:
        'Marks a claim as decision-relevant, or unpins it. Pinned claims sort to the top and survive a re-gather, so pin the ones the user says actually matter to their decision.',
      inputSchema: {
        type: 'object',
        properties: {
          claimId: { type: 'string', description: 'Claim id from get_board.' },
          pinned: { type: 'boolean', description: 'true to pin, false to unpin. Defaults to true.' },
        },
        required: ['claimId'],
      },
      execute({ claimId, pinned = true }: { claimId: string; pinned?: boolean }) {
        const claim = claimById(claimId);
        if (!claim) return fail('unknown_claim', `No claim with id "${claimId}". Call get_board for current ids.`);
        dispatch({ type: 'claim:pin', claimId, pinned, actor: 'agent', tool: 'pin_claim' });
        return ok(`${pinned ? 'Pinned' : 'Unpinned'} "${claim.text}".`, { claimId, pinned });
      },
    },
  ];
}

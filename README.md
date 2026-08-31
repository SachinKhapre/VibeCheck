# Sift

The thing everyone does manually when they append "reddit" to a Google search, turned into a page an AI agent can work on with you.

Sift gathers what real people said about a decision — laptop, mattress, bank, framework — and puts it on a board as claim cards, each with the threads behind it and a support bar showing how many independent voices back it. You do the judging: reject a source as a shill, trust one that reads like an actual owner, pin what matters, state a constraint. The support bar re-weights and the agent works from your judgments.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
# then open http://localhost:5173/?demo=1 for the cached fixture (no API keys needed)
```

Requires Node 20+.

Keys go in `.env` (see `.env.example`) and stay server-side — both API routes run as serverless functions.

- `SERPAPI_KEY` — SerpApi, used by `/api/gather`
- `ANTHROPIC_API_KEY` — used by `/api/extract` (not yet implemented)

## Demo mode

`?demo=1` serves `src/fixtures/demo-gather.json` — a full cached gather for "Is the Dell XPS 14 good for dev work?". The live path also falls back to this fixture if SerpApi is unreachable or over quota, so a cold judge never hits an error screen.

## WebMCP

The page registers six tools on `document.modelContext` (falling back to `navigator.modelContext`, then to `@mcp-b/webmcp-polyfill`):

| Tool | What it does |
| --- | --- |
| `gather_opinions` | Searches discussion sources and fills the board |
| `get_board` | Current claims, support counts, verdicts, pins, constraints |
| `drill_claim` | The threads and evidence behind one claim |
| `mark_source` | Applies a trust/reject verdict and recomputes support |
| `filter_board` | Applies a plain-language constraint |
| `pin_claim` | Marks a claim decision-relevant |

WebMCP is `[SecureContext]` — over plain HTTP `modelContext` is `undefined` and the page runs without agent tools.

The tools and the UI share one reducer and one state object ([src/state/board.ts](src/state/board.ts)). Nothing the agent does is invisible on screen, and nothing you do on screen is invisible to the agent.

## Layout

```
api/gather.ts          SerpApi (google_forums + discussion-biased google), session-cached
src/state/             the one state shape and the one reducer
src/mcp/               modelContext binding, registration hook, the six tool definitions
src/data/gather.ts     gather pipeline + fixture fallback
src/fixtures/          cached demo gather
```

## License

MIT — see [LICENSE](LICENSE).

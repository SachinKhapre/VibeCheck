# VibeCheck

The thing everyone does manually when they append "reddit" to a Google search, turned into a page an AI agent can work on with you.

VibeCheck gathers what real people said about a decision — laptop, mattress, bank, framework — and puts it on a board as claim cards, each with the threads behind it and a support bar showing how many independent voices back it. You do the judging: reject a source as a shill, trust one that reads like an actual owner, pin what matters, state a constraint. The support bar re-weights and the agent works from your judgments.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

The home page ships with recorded boards — open one and the full board loads instantly, with no keys and no network. `?demo=1` opens the flagship board directly, and `?board=<slug>` deep-links any of them.

Requires Node 22+.

Keys go in `.env` (see `.env.example`) and stay server-side — both API routes run as serverless functions.

- `SERPAPI_KEY` — SerpApi, used by `/api/gather`
- `OPENROUTER_API_KEY` — used by `/api/extract`. Works on OpenRouter's free models; `OPENROUTER_MODEL` overrides the fallback chain.

## Recorded boards

The gallery on the home page is a set of real gathers, saved. Each one is a genuine SerpApi response shaped by `api/_shape.ts`, with claims from the same extraction the live path runs — nothing is written by hand. They are bundled into the app, so they cost no credits, need no keys, and cannot fail.

They are never passed off as live: the board carries a "recorded gather" badge, and every card shows the date the search actually ran. The live path also falls back to the flagship board if SerpApi is unreachable, so a cold judge never hits an error screen.

To add one, save a SerpApi response under `raw/` and run:

```bash
node --env-file=.env scripts/build-board.ts <slug> "<topic>" raw/<file>.json "<one-line blurb>"
```

That writes `src/fixtures/<slug>.json`; list it in `src/fixtures/index.ts` and it appears in the gallery. It costs no SerpApi credit — the search already happened.

## WebMCP

The page registers six tools on `document.modelContext` (falling back to `navigator.modelContext`, then to `@mcp-b/webmcp-polyfill`). The agent-status chip in the masthead opens a panel listing them, live.

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
api/extract.ts         OpenRouter, schema-constrained: relevance, stance, claim clustering
api/_shape.ts          shared shaping of raw SerpApi rows
src/state/             the one state shape and the one reducer
src/mcp/               modelContext binding, registration hook, the six tool definitions
src/components/        claim cards, source list, activity rail, board gallery, tools panel
src/data/gather.ts     gather pipeline + recorded-board fallback
src/fixtures/          recorded boards, and the registry the gallery reads
scripts/build-board.ts turns a saved SerpApi response into a recorded board
```

## License

MIT — see [LICENSE](LICENSE).

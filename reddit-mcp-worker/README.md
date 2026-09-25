# reddit-rss-mcp

A read-only Reddit MCP server that runs on Cloudflare Workers' free tier.

Reddit's Data API closed self-service signup in November 2025 — new OAuth
credentials now need manual approval that personal projects are often refused.
But Reddit's **public web surface was never part of that priced API**: every
listing is served both as `.json` and as `.rss`, neither needing credentials.
This wraps them as an MCP server.

Reads try **JSON first** — it carries vote scores, comment counts and real
reply nesting — and fall back to **RSS** if Reddit refuses. Whichever answered
is reported as `format` on every result, so you always know whether the scores
you are looking at are real or absent.

The result works on **iOS**, where a local `stdio` MCP server cannot: the Worker
is a remote connector reached over HTTPS, so there is no process to run on your
device.

| | |
|---|---|
| **Cost** | $0 — Workers free tier is 100,000 requests/day |
| **Ranking** | Vote scores and comment counts on the JSON path |
| **Reddit credentials** | None |
| **Third parties** | None; you host it |
| **Dependencies** | None at runtime |
| **Transport** | Streamable HTTP, stateless |
| **Access** | Read-only |

## Deploy

You need a computer (this cannot be done from a phone) and a free Cloudflare
account. Clone the repo first — the four commands below run inside the cloned
`reddit-mcp-worker/` directory, not on their own:

```bash
git clone https://github.com/jarrodjohnson-gif/solar.git
cd solar
git checkout claude/reddit-laundry-advice-ttnv03
cd reddit-mcp-worker

npm install          # installs wrangler
npx wrangler login   # opens a browser to authorise Cloudflare
npm run deploy
```

`wrangler login` opens a browser tab; approve it and return to the terminal.

Wrangler prints your URL. The MCP endpoint is that URL plus `/mcp`:

```
https://reddit-mcp.<your-subdomain>.workers.dev/mcp
```

Verify it before connecting anything:

```bash
curl https://reddit-mcp.<your-subdomain>.workers.dev/health
```

## Connect

Add it as a custom connector, using the **Streamable HTTP** transport and the
`/mcp` URL. In Claude, that is Settings → Connectors → Add custom connector —
a web page, reachable from mobile Safari as well as desktop. Once connected it
works in the iOS app too.

## Tools

| Tool | Purpose |
|---|---|
| `find_subreddits` | Search for communities by name or topic |
| `browse_subreddit` | List posts by hot / new / top / rising / controversial |
| `search_reddit` | Full-text search, across Reddit or within one subreddit |
| `get_thread` | Fetch a post and its comments, by URL or ID |
| `get_user_activity` | A user's recent public posts and comments |

## Ranking, and when you lose it

`get_thread` with `sort: "top"` ranks comments by score, highest first —
verified against the returned values rather than trusting Reddit's ordering.
Listings show `42 points · 7 comments · 97% upvoted` when those numbers exist.

All of that comes from the JSON path. If Reddit refuses JSON from your Worker's
IP, reads fall back to RSS and you lose:

- **Vote scores and comment counts.** Nothing can then tell you which answer the
  community upvoted.
- **Reply nesting.** Comments arrive flat, with no parent links.
- **Meaningful ordering.** Requesting `top` still asks Reddit for that order,
  but without scores it cannot be verified.

Every result carries `format: "json" | "rss"` and `ranked: true | false`, and
the rendered text states which surface answered. On the RSS path the server
explicitly instructs the model not to describe anything as top-voted or infer
consensus from ordering, because that information genuinely is not present.

Check which path your deployment gets:

```bash
curl -s -X POST https://<your-worker>/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"browse_subreddit","arguments":{"subreddit":"laundry","limit":2}}}' \
  | grep -o '"format":"[a-z]*"'
```

`"format":"json"` means you have scores. `"format":"rss"` means you don't, and
the reason is in the fallback message.

## Configuration

Set in `wrangler.toml`, or as secrets via `npx wrangler secret put <NAME>`.

| Variable | Default | Purpose |
|---|---|---|
| `REDDIT_USER_AGENT` | a generic string | Reddit asks for a descriptive agent. Point it at a real repo or contact URL. |
| `CACHE_TTL_SECONDS` | `300` | Edge-cache lifetime for Reddit responses. |
| `FORCE_RSS` | unset | Set to `"true"` to skip the JSON attempt entirely. |
| `AUTH_TOKEN` | unset | Optional. When set, requests need it. |

### Rate limiting

Cloudflare Workers share egress IPs, so Reddit may rate-limit bursts with
HTTP 429. The edge cache is the main defence — identical repeat reads never
reach Reddit. If you see 429s, raise `CACHE_TTL_SECONDS`.

### Locking the endpoint down

A deployed Worker URL is public. The URL is unguessable, which is enough for
most personal use, but to require a token:

```bash
npx wrangler secret put AUTH_TOKEN
```

Then connect to `https://<worker>/mcp/<token>`. The token is accepted as a
trailing path segment as well as an `Authorization: Bearer` header, because
most connector UIs let you paste a URL but not a custom header.

## Development

```bash
npm test          # 81 tests, no network, no dependencies
npm run dev       # local workerd runtime on :8787
npm run tail      # stream logs from the deployed Worker
```

Tests run on `node:test` and stub `fetch`, so they need neither network access
nor a Cloudflare account.

## Design notes

**No SDK, no Durable Objects.** Stateless Streamable HTTP is a plain
request/response exchange, so the protocol is implemented directly in
`src/mcp.js`. This avoids a build step, keeps the bundle at ~9 KiB gzipped,
removes SDK version drift, and stays clear of bindings that complicate the free
tier.

**Errors reach the model, not just the transport.** Tool failures come back as
a successful JSON-RPC result carrying `isError: true`, per the MCP spec, so the
model can read what went wrong and correct itself. Only failures to *find* a
tool are protocol-level errors.

**Input is validated before it reaches a URL.** Subreddit names, usernames and
post IDs are pattern-checked, and query values go through `URLSearchParams`, so
tool arguments cannot reshape the request path or point it at another host.

| File | Role |
|---|---|
| `src/index.js` | Worker entry: routing, CORS, optional auth |
| `src/mcp.js` | JSON-RPC dispatch, protocol negotiation |
| `src/tools.js` | Tool schemas, handlers, output rendering |
| `src/reddit.js` | URLs, validation, JSON-first fetching with RSS fallback, caching |
| `src/json.js` | Reddit JSON listings, comment-tree flattening |
| `src/atom.js` | Atom parsing, HTML-to-text |

## Licence

MIT

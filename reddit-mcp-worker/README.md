# reddit-rss-mcp

A read-only Reddit MCP server that runs on Cloudflare Workers' free tier.

Reddit's Data API closed self-service signup in November 2025 — new OAuth
credentials now need manual approval that personal projects are often refused.
Reddit's **public RSS feeds were never part of that priced surface**, so they
still serve every public subreddit, user page, search and comment thread with
no credentials at all. This wraps those feeds as an MCP server.

The result works on **iOS**, where a local `stdio` MCP server cannot: the Worker
is a remote connector reached over HTTPS, so there is no process to run on your
device.

| | |
|---|---|
| **Cost** | $0 — Workers free tier is 100,000 requests/day |
| **Reddit credentials** | None |
| **Third parties** | None; you host it |
| **Dependencies** | None at runtime |
| **Transport** | Streamable HTTP, stateless |
| **Access** | Read-only |

## Deploy

You need a free Cloudflare account. From this directory:

```bash
npm install
npx wrangler login
npm run deploy
```

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

## What RSS does not carry

This is the real tradeoff, and it is worth understanding before you rely on it:

- **No vote scores and no comment counts.** Nothing here can tell you which
  answer the community upvoted. The server's own instructions tell the model not
  to claim otherwise, but it is a genuine ceiling, not a formatting quirk.
- **Comments are flat**, not threaded — replies are not linked to parents.
- **Ordering is roughly chronological.** Requesting `sort: "top"` asks Reddit
  for that order, but without scores you cannot verify what you got.

Paid Reddit MCP services built on RSS share these limits. Only the authenticated
Data API carries scores.

## Configuration

Set in `wrangler.toml`, or as secrets via `npx wrangler secret put <NAME>`.

| Variable | Default | Purpose |
|---|---|---|
| `REDDIT_USER_AGENT` | a generic string | Reddit asks for a descriptive agent. Point it at a real repo or contact URL. |
| `CACHE_TTL_SECONDS` | `300` | Edge-cache lifetime for Reddit responses. |
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
npm test          # 64 tests, no network, no dependencies
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
| `src/reddit.js` | Feed URLs, validation, fetching, caching |
| `src/atom.js` | Atom parsing, HTML-to-text |

## Licence

MIT

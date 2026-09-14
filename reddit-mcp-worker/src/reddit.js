/**
 * Reddit feed access.
 *
 * Reddit exposes every public listing twice outside the priced Data API: as
 * `.json` and as `.rss`. Neither needs credentials. JSON carries vote scores,
 * comment counts and real reply nesting; RSS carries none of that but is
 * served more permissively.
 *
 * So reads try JSON first and fall back to RSS when Reddit refuses it. Callers
 * get whichever succeeded, tagged with `format`, and the extra fields simply
 * go missing on the RSS path rather than the read failing.
 */

import { parseFeed } from './atom.js';
import { looksLikeRedditJson, parseJsonResponse } from './json.js';

const REDDIT_BASE = 'https://www.reddit.com';

export const SORTS = ['hot', 'new', 'top', 'rising', 'controversial'];
export const SEARCH_SORTS = ['relevance', 'hot', 'new', 'top', 'comments'];
export const TIME_RANGES = ['hour', 'day', 'week', 'month', 'year', 'all'];

/** Raised for bad tool input; surfaced to the model as a tool error, not a protocol error. */
export class RedditInputError extends Error {}
/** Raised when Reddit itself refuses or fails. */
export class RedditFetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {unknown} name
 * @returns {string}
 */
export function validateSubreddit(name) {
  const value = String(name ?? '').trim().replace(/^\/?r\//i, '');
  if (!/^[A-Za-z0-9_]{2,21}$/.test(value)) {
    throw new RedditInputError(
      `"${name}" is not a valid subreddit name. Use letters, digits and underscores, 2-21 characters, with or without the r/ prefix.`,
    );
  }
  return value;
}

/**
 * @param {unknown} name
 * @returns {string}
 */
export function validateUsername(name) {
  const value = String(name ?? '').trim().replace(/^\/?u(?:ser)?\//i, '');
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(value)) {
    throw new RedditInputError(
      `"${name}" is not a valid Reddit username. Use letters, digits, underscores and hyphens, 3-20 characters.`,
    );
  }
  return value;
}

/**
 * Accept a permalink, a t3_ thing ID, or a bare base-36 post ID.
 * @param {unknown} input
 * @returns {string}
 */
export function extractPostId(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new RedditInputError('A post URL or ID is required.');

  const fromUrl = value.match(/\/comments\/([a-z0-9]{4,10})/i);
  if (fromUrl) return fromUrl[1].toLowerCase();

  const fromThing = value.match(/^t3_([a-z0-9]{4,10})$/i);
  if (fromThing) return fromThing[1].toLowerCase();

  if (/^[a-z0-9]{4,10}$/i.test(value)) return value.toLowerCase();

  throw new RedditInputError(
    `Could not read a post ID from "${value}". Pass a reddit.com/r/<sub>/comments/<id>/... URL, a t3_<id> thing ID, or a bare post ID.`,
  );
}

/**
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} fallback
 * @param {string} label
 * @returns {string}
 */
export function pickOption(value, allowed, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const candidate = String(value).toLowerCase();
  if (!allowed.includes(candidate)) {
    throw new RedditInputError(
      `${label} must be one of: ${allowed.join(', ')}. Received "${value}".`,
    );
  }
  return candidate;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
export function clampLimit(value, fallback = 25, max = 100) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RedditInputError(`limit must be a number. Received "${value}".`);
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

/**
 * Build a Reddit feed URL. Query values are encoded by URLSearchParams; path
 * segments are pre-validated by the callers above.
 * @param {string} path
 * @param {Record<string, string|number|undefined>} params
 * @returns {string}
 */
export function buildFeedUrl(path, params = {}) {
  const url = new URL(path, REDDIT_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Build both representations of one Reddit path.
 *
 * @param {string} basePath extensionless, e.g. "/r/laundry/hot"
 * @param {Record<string, string|number|undefined>} [params]
 * @returns {{json: string, rss: string}}
 */
export function buildUrls(basePath, params = {}) {
  // raw_json=1 stops Reddit HTML-escaping body text in JSON responses.
  return {
    json: buildFeedUrl(`${basePath}.json`, { ...params, raw_json: 1 }),
    rss: buildFeedUrl(`${basePath}.rss`, params),
  };
}

/**
 * Map a non-OK Reddit response to an error explaining what to do about it.
 *
 * @param {number} status
 * @returns {RedditFetchError}
 */
function describeFailure(status) {
  if (status === 429) {
    return new RedditFetchError(
      'Reddit rate-limited this request (HTTP 429). Cloudflare Workers share egress IPs, so this can happen in bursts. Wait a minute and retry; raising CACHE_TTL_SECONDS makes it rarer.',
      429,
    );
  }
  if (status === 403) {
    // Two very different causes share this status: the content is restricted,
    // or Reddit is refusing this egress IP. Naming only the first sends people
    // hunting for a problem with their query that may not exist.
    return new RedditFetchError(
      "Reddit refused this request (HTTP 403). Either the subreddit or user is private, quarantined, banned or deleted, or Reddit is blocking this server's IP address. If other subreddits work, it is the former; if every request fails, it is the latter.",
      403,
    );
  }
  if (status === 404) {
    return new RedditFetchError('Reddit returned 404 — that subreddit, user, or post does not exist.', 404);
  }
  return new RedditFetchError(`Reddit returned HTTP ${status}.`, status);
}

/**
 * Fetch one URL as text, served from Cloudflare's edge cache when possible.
 *
 * Caching is not just a latency win: it is the main defence against Reddit
 * rate-limiting the Worker's shared egress IPs. Repeated identical reads cost
 * Reddit nothing.
 *
 * @param {string} url
 * @param {string} accept
 * @param {object} env
 * @param {{waitUntil?: (p: Promise<unknown>) => void}} [ctx]
 * @returns {Promise<{text: string, cached: boolean}>}
 */
async function fetchText(url, accept, env = {}, ctx = undefined) {
  const ttl = Number.parseInt(env.CACHE_TTL_SECONDS ?? '300', 10);
  const userAgent =
    env.REDDIT_USER_AGENT || 'reddit-mcp-worker/1.0 (Cloudflare Worker; +https://github.com)';

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(url, { method: 'GET' });

  if (cache && ttl > 0) {
    const hit = await cache.match(cacheKey);
    if (hit) return { text: await hit.text(), cached: true };
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: accept },
    });
  } catch (cause) {
    throw new RedditFetchError(`Could not reach Reddit: ${cause.message}`, 502);
  }

  if (!response.ok) throw describeFailure(response.status);

  const text = await response.text();

  if (cache && ttl > 0) {
    const write = cache.put(
      cacheKey,
      new Response(text, { headers: { 'Cache-Control': `public, max-age=${ttl}` } }),
    );
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
  }

  return { text, cached: false };
}

/**
 * Fetch and parse an Atom feed.
 *
 * @param {string} url
 * @param {object} env
 * @param {object} [ctx]
 * @returns {Promise<object>}
 */
export async function fetchFeed(url, env = {}, ctx = undefined) {
  const { text, cached } = await fetchText(
    url,
    'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    env,
    ctx,
  );
  const parsed = parseFeed(text);
  if (parsed.entries.length === 0 && !/<feed[\s>]/i.test(text)) {
    throw new RedditFetchError('Reddit returned a response that was not an Atom feed.', 502);
  }
  return { ...parsed, format: 'rss', cached, source: url };
}

/**
 * Fetch and parse a JSON listing.
 *
 * @param {string} url
 * @param {object} env
 * @param {object} [ctx]
 * @returns {Promise<object>}
 */
export async function fetchJson(url, env = {}, ctx = undefined) {
  const { text, cached } = await fetchText(url, 'application/json', env, ctx);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new RedditFetchError('Reddit returned a response that was not JSON.', 502);
  }
  if (!looksLikeRedditJson(payload)) {
    throw new RedditFetchError('Reddit returned JSON in an unexpected shape.', 502);
  }

  return { ...parseJsonResponse(payload), format: 'json', cached, source: url };
}

/**
 * Read a Reddit path, preferring JSON for its scores and falling back to RSS.
 *
 * Falls back on the failures that mean "JSON specifically is unavailable":
 * a 403 refusal, or a body that is not the JSON we expect. A 404 means the
 * content does not exist on either path, and a 429 means Reddit is already
 * rate-limiting us, so neither is retried against RSS.
 *
 * @param {string} basePath extensionless Reddit path
 * @param {Record<string, string|number|undefined>} params
 * @param {object} env
 * @param {object} [ctx]
 * @returns {Promise<object>}
 */
export async function fetchListing(basePath, params, env = {}, ctx = undefined) {
  const urls = buildUrls(basePath, params);

  if (env.FORCE_RSS === 'true' || env.FORCE_RSS === true) {
    return fetchFeed(urls.rss, env, ctx);
  }

  try {
    return await fetchJson(urls.json, env, ctx);
  } catch (cause) {
    const retryable =
      cause instanceof RedditFetchError && (cause.status === 403 || cause.status === 502);
    if (!retryable) throw cause;

    const feed = await fetchFeed(urls.rss, env, ctx);
    return { ...feed, fallbackFrom: 'json', fallbackReason: cause.message };
  }
}

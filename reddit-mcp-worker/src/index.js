/**
 * Cloudflare Worker entry point.
 *
 * Serves an MCP server over Streamable HTTP in stateless mode: each POST to
 * /mcp carries a complete JSON-RPC message and gets a complete reply. No
 * session store, so no Durable Objects, so nothing here leaves the free tier.
 */

import { handleMessage, SERVER_INFO } from './mcp.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
function json(body, status = 200, headers = {}) {
  return new Response(body === null ? '' : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

/**
 * When AUTH_TOKEN is set, the Worker accepts it either as a bearer token or as
 * a trailing path segment. The path form exists because MCP client UIs
 * generally let you paste a URL but not a custom header.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {{AUTH_TOKEN?: string}} env
 * @returns {boolean}
 */
function isAuthorized(request, url, env) {
  const expected = env.AUTH_TOKEN;
  if (!expected) return true;

  const header = request.headers.get('Authorization') || '';
  const bearer = header.replace(/^Bearer\s+/i, '').trim();
  if (bearer && bearer === expected) return true;

  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length > 1 && segments[segments.length - 1] === expected;
}

/**
 * @param {URL} url
 * @returns {boolean}
 */
function isMcpPath(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments[0] === 'mcp';
}

const LANDING_PAGE = `reddit-rss-mcp

A read-only MCP server for Reddit, backed by Reddit's public RSS feeds.
No Reddit API credentials, no third-party data broker.

  MCP endpoint   POST /mcp
  Health         GET  /health

Add the /mcp URL as a custom connector in your MCP client, using the
Streamable HTTP transport.

Tools: search_reddit, browse_subreddit, get_thread, get_user_activity,
       find_subreddits

Feeds carry no vote scores or comment counts, and comment lists are flat.
`;

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string>} env
   * @param {{waitUntil: (p: Promise<unknown>) => void}} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', server: SERVER_INFO });
    }

    if (!isMcpPath(url)) {
      return new Response(LANDING_PAGE, {
        status: url.pathname === '/' ? 200 : 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS },
      });
    }

    if (!isAuthorized(request, url, env)) {
      return json(
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized.' } },
        401,
        { 'WWW-Authenticate': 'Bearer' },
      );
    }

    // Stateless mode: there is no server-initiated stream to open, and no
    // session state to delete. Both are valid per the Streamable HTTP spec.
    if (request.method === 'GET') {
      return json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'This server is stateless; SSE streaming is not offered. POST JSON-RPC messages to this endpoint.' } },
        405,
        { Allow: 'POST, DELETE, OPTIONS' },
      );
    }
    if (request.method === 'DELETE') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Method ${request.method} not allowed.` } },
        405,
        { Allow: 'POST, DELETE, OPTIONS' },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Request body is not valid JSON.' } },
        400,
      );
    }

    const response = await handleMessage(body, env, ctx);

    // A body containing only notifications produces no response payload.
    if (response === null) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }
    return json(response);
  },
};

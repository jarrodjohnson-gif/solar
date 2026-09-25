import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { stubFetch } from './fixtures.js';

const ENV = { CACHE_TTL_SECONDS: '0', REDDIT_USER_AGENT: 'test/1.0' };
const CTX = { waitUntil() {} };

/** @param {object} body @param {string} [path] @param {object} [init] */
function post(body, path = '/mcp', init = {}) {
  return new Request(`https://worker.example.dev${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    body: JSON.stringify(body),
  });
}

test('POST /mcp serves JSON-RPC', async () => {
  const response = await worker.fetch(
    post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    ENV,
    CTX,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  const body = await response.json();
  assert.equal(body.result.tools.length, 5);
});

test('POST /mcp runs a tool end to end', async () => {
  stubFetch();
  const response = await worker.fetch(
    post({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'browse_subreddit', arguments: { subreddit: 'laundry' } },
    }),
    ENV,
    CTX,
  );
  const body = await response.json();
  assert.equal(body.id, 7);
  assert.match(body.result.content[0].text, /r\/laundry/);
});

test('a notification-only POST returns 202 with no body', async () => {
  const response = await worker.fetch(
    post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ENV,
    CTX,
  );
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
});

test('invalid JSON returns a parse error', async () => {
  const request = new Request('https://worker.example.dev/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  const response = await worker.fetch(request, ENV, CTX);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, -32700);
});

test('GET /mcp explains that the server is stateless', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example.dev/mcp'),
    ENV,
    CTX,
  );
  assert.equal(response.status, 405);
  assert.match((await response.json()).error.message, /stateless/i);
});

test('DELETE /mcp is accepted as a no-op session teardown', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example.dev/mcp', { method: 'DELETE' }),
    ENV,
    CTX,
  );
  assert.equal(response.status, 204);
});

test('OPTIONS returns CORS preflight headers', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example.dev/mcp', { method: 'OPTIONS' }),
    ENV,
    CTX,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /MCP-Protocol-Version/);
});

test('GET /health reports server identity', async () => {
  const response = await worker.fetch(new Request('https://worker.example.dev/health'), ENV, CTX);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.server.name, 'reddit-rss-mcp');
});

test('the root path documents the endpoint', async () => {
  const response = await worker.fetch(new Request('https://worker.example.dev/'), ENV, CTX);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /POST \/mcp/);
});

test('unknown paths 404', async () => {
  const response = await worker.fetch(new Request('https://worker.example.dev/nope'), ENV, CTX);
  assert.equal(response.status, 404);
});

test('without AUTH_TOKEN the endpoint is open', async () => {
  const response = await worker.fetch(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), ENV, CTX);
  assert.equal(response.status, 200);
});

test('with AUTH_TOKEN an unauthenticated request is rejected', async () => {
  const secured = { ...ENV, AUTH_TOKEN: 's3cret' };
  const response = await worker.fetch(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), secured, CTX);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
});

test('AUTH_TOKEN accepts a bearer header', async () => {
  const secured = { ...ENV, AUTH_TOKEN: 's3cret' };
  const response = await worker.fetch(
    post({ jsonrpc: '2.0', id: 1, method: 'ping' }, '/mcp', {
      headers: { Authorization: 'Bearer s3cret' },
    }),
    secured,
    CTX,
  );
  assert.equal(response.status, 200);
});

test('AUTH_TOKEN accepts a trailing path segment, for clients that only take a URL', async () => {
  const secured = { ...ENV, AUTH_TOKEN: 's3cret' };
  const ok = await worker.fetch(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, '/mcp/s3cret'), secured, CTX);
  assert.equal(ok.status, 200);

  const wrong = await worker.fetch(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, '/mcp/guess'), secured, CTX);
  assert.equal(wrong.status, 401);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  ErrorCode,
  handleMessage,
  handleRpc,
  negotiateProtocolVersion,
} from '../src/mcp.js';
import { TOOLS } from '../src/tools.js';
import {
  COMMENTS_FEED,
  COMMENTS_JSON,
  EMPTY_FEED,
  LISTING_FEED,
  LISTING_JSON,
  stubFetch,
  stubFetchRssOnly,
} from './fixtures.js';

const ENV = { CACHE_TTL_SECONDS: '0', REDDIT_USER_AGENT: 'test/1.0' };

/** @param {string} method @param {object} [params] */
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

test('initialize echoes a supported protocol version', async () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    const response = await handleRpc(rpc('initialize', { protocolVersion: version }), ENV);
    assert.equal(response.result.protocolVersion, version);
  }
});

test('initialize falls back to latest for an unknown version', () => {
  assert.equal(negotiateProtocolVersion('1999-01-01'), LATEST_PROTOCOL_VERSION);
  assert.equal(negotiateProtocolVersion(undefined), LATEST_PROTOCOL_VERSION);
});

test('initialize advertises tools and carries usage instructions', async () => {
  const { result } = await handleRpc(rpc('initialize', {}), ENV);
  assert.deepEqual(result.capabilities.tools, { listChanged: false });
  assert.equal(result.serverInfo.name, 'reddit-rss-mcp');
  assert.match(result.instructions, /no vote scores/i);
});

test('tools/list returns every tool with a spec-valid input schema', async () => {
  const { result } = await handleRpc(rpc('tools/list'), ENV);
  assert.equal(result.tools.length, TOOLS.length);

  for (const tool of result.tools) {
    assert.ok(tool.name, 'tool needs a name');
    assert.ok(tool.description, `${tool.name} needs a description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} input schema must be an object`);
    assert.ok(tool.inputSchema.properties, `${tool.name} needs properties`);
    if (tool.outputSchema) {
      assert.equal(tool.outputSchema.type, 'object', `${tool.name} output schema must be an object`);
    }
    assert.equal(typeof tool.handler, 'undefined', 'handlers must not go over the wire');
  }
});

test('tools/list marks every tool read-only', async () => {
  const { result } = await handleRpc(rpc('tools/list'), ENV);
  assert.ok(result.tools.every((tool) => tool.annotations?.readOnlyHint === true));
});

test('ping returns an empty result', async () => {
  const { result } = await handleRpc(rpc('ping'), ENV);
  assert.deepEqual(result, {});
});

test('notifications get no response', async () => {
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, ENV), null);
});

test('unknown methods return MethodNotFound', async () => {
  const response = await handleRpc(rpc('does/not/exist'), ENV);
  assert.equal(response.error.code, ErrorCode.MethodNotFound);
});

test('malformed requests are rejected', async () => {
  assert.equal((await handleRpc(null, ENV)).error.code, ErrorCode.InvalidRequest);
  assert.equal((await handleRpc({ jsonrpc: '1.0', id: 1 }, ENV)).error.code, ErrorCode.InvalidRequest);
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 1 }, ENV)).error.code, ErrorCode.InvalidRequest);
});

test('search_reddit queries the search feed and renders results', async () => {
  const calls = stubFetch();
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'search_reddit', arguments: { query: 'citric acid', subreddit: 'laundry' } }),
    ENV,
  );

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/r/laundry/search.json');
  assert.equal(url.searchParams.get('q'), 'citric acid');
  assert.equal(url.searchParams.get('restrict_sr'), '1');

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Citric acid routine/);
  assert.equal(result.structuredContent.count, 2);
  assert.equal(result.structuredContent.entries[0].author, 'soapfan');
});

test('browse_subreddit applies a time window only to top and controversial', async () => {
  let calls = stubFetch();
  await handleRpc(rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: 'laundry' } }), ENV);
  assert.equal(new URL(calls[0].url).pathname, '/r/laundry/hot.json');
  assert.equal(new URL(calls[0].url).searchParams.has('t'), false);

  calls = stubFetch();
  await handleRpc(
    rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: 'laundry', sort: 'top', time: 'year' } }),
    ENV,
  );
  assert.equal(new URL(calls[0].url).pathname, '/r/laundry/top.json');
  assert.equal(new URL(calls[0].url).searchParams.get('t'), 'year');
});

test('get_thread accepts a permalink and separates post from comments', async () => {
  const calls = stubFetch({ json: COMMENTS_JSON, xml: COMMENTS_FEED });
  const { result } = await handleRpc(
    rpc('tools/call', {
      name: 'get_thread',
      arguments: { post: 'https://www.reddit.com/r/laundry/comments/abc123/citric_acid/' },
    }),
    ENV,
  );

  assert.equal(new URL(calls[0].url).pathname, '/comments/abc123.json');
  assert.equal(result.structuredContent.format, 'json');
  // Three comments: two top-level plus one nested reply. The `more`
  // placeholder in the fixture must not appear as a fourth.
  assert.equal(result.structuredContent.comment_count, 3);
  assert.match(result.content[0].text, /Citric acid routine/);
  assert.match(result.content[0].text, /kills the enzymes/);
});

test('get_thread carries scores and reply depth from the JSON path', async () => {
  stubFetch({ json: COMMENTS_JSON, xml: COMMENTS_FEED });
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'get_thread', arguments: { post: 'abc123' } }),
    ENV,
  );

  assert.equal(result.structuredContent.ranked, true);
  assert.equal(result.structuredContent.post.score, 128);
  assert.match(result.content[0].text, /128 points/);

  const nested = result.structuredContent.comments.find((c) => c.author === 'nested');
  assert.equal(nested.depth, 1);
  assert.equal(nested.parent_id, 't1_ccc111');
});

test('get_thread with sort "top" ranks comments by score', async () => {
  stubFetch({ json: COMMENTS_JSON, xml: COMMENTS_FEED });
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'get_thread', arguments: { post: 'abc123', sort: 'top' } }),
    ENV,
  );

  const scores = result.structuredContent.comments.map((c) => c.score);
  assert.deepEqual(scores, [94, 11, 3], 'comments should be ordered by score, highest first');
  assert.match(result.content[0].text, /ranked by score/);
});

test('a JSON refusal falls back to RSS and degrades to unranked', async () => {
  const calls = stubFetch({ jsonStatus: 403, xml: COMMENTS_FEED });
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'get_thread', arguments: { post: 'abc123' } }),
    ENV,
  );

  assert.equal(calls.length, 2, 'should try .json then .rss');
  assert.ok(calls[0].url.includes('.json'));
  assert.ok(calls[1].url.includes('.rss'));
  assert.equal(result.isError, undefined, 'the fallback should succeed, not error');
  assert.equal(result.structuredContent.format, 'rss');
  assert.equal(result.structuredContent.ranked, false);
  assert.match(result.content[0].text, /no vote scores/i);
});

test('listings report scores when JSON answers', async () => {
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: 'laundry' } }),
    (stubFetch(), ENV),
  );
  assert.equal(result.structuredContent.ranked, true);
  assert.equal(result.structuredContent.entries[0].score, 128);
  assert.match(result.content[0].text, /128 points · 12 comments · 97% upvoted/);
});

test('rate limiting is not retried against RSS', async () => {
  const calls = stubFetch({ xml: '', status: 429, jsonStatus: 429 });
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: 'laundry' } }),
    ENV,
  );
  assert.equal(calls.length, 1, 'a 429 means back off, not try the other path');
  assert.equal(result.isError, true);
});

test('a 404 is not retried against RSS either', async () => {
  const calls = stubFetch({ xml: '', status: 404, jsonStatus: 404 });
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: 'laundry' } }),
    ENV,
  );
  assert.equal(calls.length, 1);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /does not exist/);
});

test('get_user_activity routes overview and filtered views differently', async () => {
  let calls = stubFetch();
  await handleRpc(rpc('tools/call', { name: 'get_user_activity', arguments: { username: 'soapfan' } }), ENV);
  assert.equal(new URL(calls[0].url).pathname, '/user/soapfan.json');

  calls = stubFetch();
  await handleRpc(
    rpc('tools/call', { name: 'get_user_activity', arguments: { username: 'u/soapfan', kind: 'comments' } }),
    ENV,
  );
  assert.equal(new URL(calls[0].url).pathname, '/user/soapfan/comments.json');
});

test('find_subreddits queries the subreddit search feed', async () => {
  const calls = stubFetch();
  await handleRpc(rpc('tools/call', { name: 'find_subreddits', arguments: { query: 'laundry' } }), ENV);
  assert.equal(new URL(calls[0].url).pathname, '/subreddits/search.json');
});

test('an empty feed reads as no results rather than an error', async () => {
  stubFetchRssOnly(EMPTY_FEED);
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: 'laundry' } }),
    ENV,
  );
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /No results/);
  assert.equal(result.structuredContent.count, 0);
});

test('bad tool arguments come back as isError so the model can retry', async () => {
  stubFetch();
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: '../../etc' } }),
    ENV,
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not a valid subreddit/);
});

test('Reddit failures come back as isError with the cause', async () => {
  stubFetch({ xml: '', status: 429, jsonStatus: 429 });
  const { result } = await handleRpc(
    rpc('tools/call', { name: 'browse_subreddit', arguments: { subreddit: 'laundry' } }),
    ENV,
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /rate-limited/i);
});

test('an unknown tool is a protocol error, not a tool error', async () => {
  const response = await handleRpc(rpc('tools/call', { name: 'no_such_tool', arguments: {} }), ENV);
  assert.equal(response.error.code, ErrorCode.InvalidParams);
  assert.match(response.error.message, /Available tools/);
});

test('batches reply per request and drop notifications', async () => {
  stubFetch();
  const responses = await handleMessage(
    [
      rpc('ping', {}, 1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc('tools/list', {}, 2),
    ],
    ENV,
  );
  assert.equal(responses.length, 2);
  assert.deepEqual(responses.map((entry) => entry.id), [1, 2]);
});

test('a batch of only notifications produces no response', async () => {
  assert.equal(await handleMessage([{ jsonrpc: '2.0', method: 'notifications/initialized' }], ENV), null);
});

test('an empty batch is rejected', async () => {
  const response = await handleMessage([], ENV);
  assert.equal(response.error.code, ErrorCode.InvalidRequest);
});

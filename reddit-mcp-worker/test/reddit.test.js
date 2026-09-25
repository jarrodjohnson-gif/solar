import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RedditFetchError,
  RedditInputError,
  buildFeedUrl,
  clampLimit,
  extractPostId,
  fetchFeed,
  pickOption,
  validateSubreddit,
  validateUsername,
} from '../src/reddit.js';
import { LISTING_FEED, stubFetch, stubFetchRssOnly } from './fixtures.js';

test('validateSubreddit accepts bare and prefixed names', () => {
  assert.equal(validateSubreddit('laundry'), 'laundry');
  assert.equal(validateSubreddit('r/laundry'), 'laundry');
  assert.equal(validateSubreddit('/r/laundry'), 'laundry');
  assert.equal(validateSubreddit('  BuyItForLife '), 'BuyItForLife');
});

test('validateSubreddit rejects names that could alter the URL path', () => {
  for (const bad of ['../../admin', 'a', 'has space', 'has/slash', 'x'.repeat(22), '']) {
    assert.throws(() => validateSubreddit(bad), RedditInputError, `expected rejection: ${bad}`);
  }
});

test('validateUsername accepts bare and prefixed names', () => {
  assert.equal(validateUsername('soapfan'), 'soapfan');
  assert.equal(validateUsername('u/soapfan'), 'soapfan');
  assert.equal(validateUsername('/user/soapfan'), 'soapfan');
});

test('validateUsername rejects invalid names', () => {
  for (const bad of ['ab', 'has space', 'has/slash', '']) {
    assert.throws(() => validateUsername(bad), RedditInputError);
  }
});

test('extractPostId reads permalinks, thing IDs and bare IDs', () => {
  assert.equal(
    extractPostId('https://www.reddit.com/r/laundry/comments/abc123/citric_acid/'),
    'abc123',
  );
  assert.equal(extractPostId('t3_abc123'), 'abc123');
  assert.equal(extractPostId('abc123'), 'abc123');
  assert.equal(extractPostId('ABC123'), 'abc123');
});

test('extractPostId rejects unusable input', () => {
  for (const bad of ['', 'https://example.com/nope', 'way-too-long-to-be-an-id']) {
    assert.throws(() => extractPostId(bad), RedditInputError);
  }
});

test('pickOption falls back and validates against the allowed set', () => {
  assert.equal(pickOption(undefined, ['a', 'b'], 'a', 'sort'), 'a');
  assert.equal(pickOption('B', ['a', 'b'], 'a', 'sort'), 'b');
  assert.throws(() => pickOption('c', ['a', 'b'], 'a', 'sort'), RedditInputError);
});

test('clampLimit bounds values and rejects non-numbers', () => {
  assert.equal(clampLimit(undefined), 25);
  assert.equal(clampLimit(5), 5);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(5000), 100);
  assert.equal(clampLimit('10'), 10);
  assert.throws(() => clampLimit('abc'), RedditInputError);
});

test('buildFeedUrl encodes query values and drops empties', () => {
  const url = buildFeedUrl('/search.rss', { q: 'tide & citric', sort: 'top', t: undefined, limit: 10 });
  assert.match(url, /^https:\/\/www\.reddit\.com\/search\.rss\?/);
  assert.ok(url.includes('q=tide+%26+citric'), `query not encoded: ${url}`);

  const params = new URL(url).searchParams;
  assert.equal(params.get('q'), 'tide & citric');
  assert.equal(params.get('sort'), 'top');
  assert.equal(params.get('limit'), '10');
  assert.equal(params.has('t'), false, 'undefined params should be omitted');
});

test('buildFeedUrl cannot be escaped to another host', () => {
  const url = buildFeedUrl('/r/laundry/hot.rss', { q: 'https://evil.example.com' });
  assert.ok(url.startsWith('https://www.reddit.com/'), url);
});

test('fetchFeed parses a feed and sends a descriptive User-Agent', async () => {
  const calls = stubFetchRssOnly();
  const feed = await fetchFeed('https://www.reddit.com/r/laundry/hot.rss', {
    REDDIT_USER_AGENT: 'test-agent/1.0',
    CACHE_TTL_SECONDS: '0',
  });
  assert.equal(feed.entries.length, 2);
  assert.equal(feed.cached, false);
  assert.equal(calls[0].init.headers['User-Agent'], 'test-agent/1.0');
});

test('fetchFeed maps Reddit rate limiting to an actionable message', async () => {
  stubFetch({ xml: '', status: 429, jsonStatus: 429 });
  await assert.rejects(
    () => fetchFeed('https://www.reddit.com/r/laundry/hot.rss', { CACHE_TTL_SECONDS: '0' }),
    (error) => {
      assert.ok(error instanceof RedditFetchError);
      assert.equal(error.status, 429);
      assert.match(error.message, /rate-limited/i);
      assert.match(error.message, /CACHE_TTL_SECONDS/);
      return true;
    },
  );
});

test('fetchFeed explains 403 and 404 distinctly', async () => {
  stubFetch({ xml: '', status: 403, jsonStatus: 403 });
  await assert.rejects(
    () => fetchFeed('https://www.reddit.com/r/x/hot.rss', { CACHE_TTL_SECONDS: '0' }),
    /private, quarantined, banned or deleted/,
  );

  stubFetch({ xml: '', status: 404, jsonStatus: 404 });
  await assert.rejects(
    () => fetchFeed('https://www.reddit.com/r/x/hot.rss', { CACHE_TTL_SECONDS: '0' }),
    /does not exist/,
  );
});

test('fetchFeed rejects a non-feed body', async () => {
  stubFetch({ xml: '<html>blocked</html>' });
  await assert.rejects(
    () => fetchFeed('https://www.reddit.com/r/x/hot.rss', { CACHE_TTL_SECONDS: '0' }),
    /not an Atom feed/,
  );
});

test('fetchFeed surfaces network failures as 502', async () => {
  globalThis.caches = undefined;
  globalThis.fetch = async () => {
    throw new Error('connection reset');
  };
  await assert.rejects(
    () => fetchFeed('https://www.reddit.com/r/x/hot.rss', { CACHE_TTL_SECONDS: '0' }),
    (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /connection reset/);
      return true;
    },
  );
});

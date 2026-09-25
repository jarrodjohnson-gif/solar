import test from 'node:test';
import assert from 'node:assert/strict';

import {
  flattenComments,
  looksLikeRedditJson,
  parseJsonResponse,
  parseListing,
  parseThing,
} from '../src/json.js';
import { COMMENTS_JSON, LISTING_JSON } from './fixtures.js';

test('parseThing normalises a post and keeps its stats', () => {
  const entry = parseThing({
    kind: 't3',
    data: {
      id: 'abc',
      name: 't3_abc',
      title: 'T',
      author: 'me',
      subreddit: 'laundry',
      permalink: '/r/laundry/comments/abc/t/',
      created_utc: 1757500000,
      selftext: 'body',
      score: 42,
      num_comments: 7,
      upvote_ratio: 0.95,
    },
  });
  assert.equal(entry.type, 'post');
  assert.equal(entry.score, 42);
  assert.equal(entry.num_comments, 7);
  assert.equal(entry.upvote_ratio, 0.95);
  assert.equal(entry.url, 'https://www.reddit.com/r/laundry/comments/abc/t/');
  assert.match(entry.published, /^2025-/);
});

test('parseThing distinguishes a missing score from a zero score', () => {
  const withZero = parseThing({ kind: 't1', data: { id: 'a', body: 'x', score: 0 } });
  const without = parseThing({ kind: 't1', data: { id: 'b', body: 'x' } });
  assert.equal(withZero.score, 0);
  assert.equal('score' in without, false);
});

test('parseThing drops kinds that carry no content', () => {
  assert.equal(parseThing({ kind: 'more', data: { count: 5 } }), null);
  assert.equal(parseThing({ kind: 't3' }), null);
  assert.equal(parseThing(null), null);
});

test('parseThing treats a deleted author as absent', () => {
  const entry = parseThing({ kind: 't1', data: { id: 'a', body: 'x', author: '[deleted]' } });
  assert.equal(entry.author, '');
});

test('parseListing maps a listing to entries', () => {
  const entries = parseListing(JSON.parse(LISTING_JSON));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].score, 128);
  assert.equal(entries[1].title, 'Enzyme tips');
});

test('parseListing tolerates malformed input', () => {
  assert.deepEqual(parseListing(null), []);
  assert.deepEqual(parseListing({ data: {} }), []);
});

test('flattenComments walks replies depth-first and records depth', () => {
  const [, commentListing] = JSON.parse(COMMENTS_JSON);
  const comments = flattenComments(commentListing);

  assert.deepEqual(
    comments.map((c) => [c.author, c.depth]),
    [['lowscore', 0], ['nested', 1], ['topvoted', 0]],
    'a reply should immediately follow its parent, one level deeper',
  );
});

test('flattenComments skips `more` placeholders', () => {
  const [, commentListing] = JSON.parse(COMMENTS_JSON);
  assert.equal(flattenComments(commentListing).length, 3, 'the `more` stub is not a comment');
});

test('parseJsonResponse separates the post from its comments', () => {
  const parsed = parseJsonResponse(JSON.parse(COMMENTS_JSON));
  assert.equal(parsed.post.title, 'Citric acid routine');
  assert.equal(parsed.post.score, 128);
  assert.equal(parsed.entries.length, 3);
  assert.ok(parsed.entries.every((entry) => entry.type === 'comment'));
});

test('parseJsonResponse handles a plain listing', () => {
  const parsed = parseJsonResponse(JSON.parse(LISTING_JSON));
  assert.equal(parsed.post, null);
  assert.equal(parsed.entries.length, 2);
});

test('looksLikeRedditJson rejects anything that is not a Reddit listing', () => {
  assert.equal(looksLikeRedditJson(JSON.parse(LISTING_JSON)), true);
  assert.equal(looksLikeRedditJson(JSON.parse(COMMENTS_JSON)), true);
  assert.equal(looksLikeRedditJson({ error: 403, message: 'Forbidden' }), false);
  assert.equal(looksLikeRedditJson([]), false);
  assert.equal(looksLikeRedditJson('<html>'), false);
  assert.equal(looksLikeRedditJson(null), false);
});

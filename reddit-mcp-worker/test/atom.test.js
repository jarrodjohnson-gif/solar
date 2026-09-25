import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeEntities,
  htmlToText,
  parseEntry,
  parseFeed,
  splitThingId,
  stripRedditFooter,
} from '../src/atom.js';
import { COMMENTS_FEED, EMPTY_FEED, LISTING_FEED } from './fixtures.js';

test('decodeEntities handles named, decimal and hex references', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;div&gt;'), '<div>');
  assert.equal(decodeEntities('it&#39;s'), "it's");
  assert.equal(decodeEntities('it&#x27;s'), "it's");
  assert.equal(decodeEntities('&hellip;'), '…');
});

test('decodeEntities leaves unknown entities untouched', () => {
  assert.equal(decodeEntities('&notareal;'), '&notareal;');
});

test('decodeEntities rejects out-of-range code points without throwing', () => {
  assert.equal(decodeEntities('&#1114112;'), '&#1114112;');
});

test('htmlToText preserves paragraphs, lists and blockquotes', () => {
  const html = '<div class="md"><p>One</p><p>Two</p><ul><li>A</li><li>B</li></ul></div>';
  const text = htmlToText(html);
  assert.equal(text, 'One\n\nTwo\n\n- A\n- B');
});

test('htmlToText keeps link targets when they differ from the label', () => {
  assert.equal(
    htmlToText('<a href="https://example.com">docs</a>'),
    'docs (https://example.com)',
  );
  assert.equal(
    htmlToText('<a href="https://example.com">https://example.com</a>'),
    'https://example.com',
  );
});

test('htmlToText decodes entities after stripping tags', () => {
  assert.equal(htmlToText('<p>Tide &amp; citric</p>'), 'Tide & citric');
});

test('stripRedditFooter removes the trailing link/comments boilerplate', () => {
  const text = 'Real body.\n\nsubmitted by /u/someone [link] [comments]';
  assert.equal(stripRedditFooter(text), 'Real body.');
});

test('splitThingId separates kind from base-36 id', () => {
  assert.deepEqual(splitThingId('t3_abc123'), { kind: 't3', id: 'abc123' });
  assert.deepEqual(splitThingId('t1_ccc111'), { kind: 't1', id: 'ccc111' });
  assert.deepEqual(splitThingId('nonsense'), { kind: '', id: 'nonsense' });
});

test('parseFeed reads feed metadata without picking up entry titles', () => {
  const feed = parseFeed(LISTING_FEED);
  assert.equal(feed.title, 'Laundry');
  assert.equal(feed.subtitle, 'All things laundry');
  assert.equal(feed.entries.length, 2);
});

test('parseFeed extracts entry fields and cleans bodies', () => {
  const [first] = parseFeed(LISTING_FEED).entries;
  assert.equal(first.id, 'abc123');
  assert.equal(first.type, 'post');
  assert.equal(first.title, 'Citric acid routine');
  assert.equal(first.author, 'soapfan');
  assert.equal(first.subreddit, 'laundry');
  assert.equal(first.published, '2026-09-10T11:00:00+00:00');
  assert.match(first.url, /comments\/abc123/);
  assert.equal(first.body, 'I add citric acid to the rinse only.\n\nNever with detergent & never hot.');
  assert.ok(!first.body.includes('[link]'), 'footer boilerplate should be stripped');
});

test('parseFeed identifies comments as comment entries', () => {
  const feed = parseFeed(COMMENTS_FEED);
  assert.equal(feed.title, 'Citric acid routine');
  assert.equal(feed.entries.length, 2);
  assert.ok(feed.entries.every((entry) => entry.type === 'comment'));
  assert.equal(feed.entries[1].body, "Also add a builder if you're on hard water.");
});

test('parseFeed returns an empty result for a feed with no entries', () => {
  assert.deepEqual(parseFeed(EMPTY_FEED).entries, []);
});

test('parseFeed returns an empty result for non-feed input', () => {
  assert.deepEqual(parseFeed('<html><body>nope</body></html>').entries, []);
  assert.deepEqual(parseFeed('').entries, []);
});

test('parseEntry tolerates missing optional fields', () => {
  const entry = parseEntry('<id>t3_xyz789</id><title>Bare</title>');
  assert.equal(entry.id, 'xyz789');
  assert.equal(entry.title, 'Bare');
  assert.equal(entry.author, '');
  assert.equal(entry.body, '');
});

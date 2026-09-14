/**
 * MCP tool definitions and handlers.
 *
 * Each tool returns both a readable text rendering (what the model actually
 * reads) and `structuredContent` matching its declared `outputSchema` (what
 * a programmatic client can consume). The MCP spec requires the structured
 * field whenever an output schema is declared.
 */

import {
  SORTS,
  SEARCH_SORTS,
  TIME_RANGES,
  buildFeedUrl,
  clampLimit,
  extractPostId,
  fetchFeed,
  pickOption,
  validateSubreddit,
  validateUsername,
} from './reddit.js';

/** Feeds carry no score or comment count; say so once rather than in every tool. */
const FEED_CAVEAT =
  'Served from Reddit public RSS: no vote scores or comment counts, and comment lists are flat rather than threaded.';

const ENTRY_PROPERTIES = {
  id: { type: 'string', description: 'Reddit base-36 ID' },
  type: { type: 'string', description: 'post, comment, or subreddit' },
  title: { type: 'string' },
  author: { type: 'string', description: 'Username without the u/ prefix' },
  subreddit: { type: 'string' },
  url: { type: 'string' },
  published: { type: 'string', description: 'ISO 8601 timestamp' },
  body: { type: 'string', description: 'Plain-text body, tags stripped' },
};

const LISTING_OUTPUT = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    count: { type: 'integer' },
    source: { type: 'string', description: 'The Reddit feed URL that was read' },
    cached: { type: 'boolean' },
    entries: {
      type: 'array',
      items: { type: 'object', properties: ENTRY_PROPERTIES },
    },
  },
  required: ['count', 'entries'],
};

/**
 * Render one entry as a compact markdown block.
 * @param {object} entry
 * @param {number} index
 * @returns {string}
 */
function renderEntry(entry, index) {
  const lines = [];
  const heading = entry.title || `${entry.type} by u/${entry.author || 'unknown'}`;
  lines.push(`### ${index}. ${heading}`);

  const meta = [];
  if (entry.subreddit) meta.push(`r/${entry.subreddit}`);
  if (entry.author) meta.push(`u/${entry.author}`);
  if (entry.published) meta.push(entry.published.slice(0, 10));
  if (meta.length) lines.push(meta.join(' · '));

  if (entry.body) {
    const body = entry.body.length > 1500 ? `${entry.body.slice(0, 1500)}…` : entry.body;
    lines.push('', body);
  }
  if (entry.url) lines.push('', entry.url);
  return lines.join('\n');
}

/**
 * @param {string} heading
 * @param {object} feed
 * @param {string} [note]
 * @returns {string}
 */
function renderListing(heading, feed, note) {
  const parts = [`## ${heading}`];
  if (note) parts.push(note);
  if (feed.entries.length === 0) {
    parts.push('', 'No results. Reddit returned an empty feed for this query.');
  } else {
    parts.push('', ...feed.entries.map((entry, i) => renderEntry(entry, i + 1)));
  }
  parts.push('', `_${FEED_CAVEAT}_`);
  return parts.join('\n\n');
}

/**
 * @param {object} feed
 * @param {string} query
 * @returns {object}
 */
function structuredListing(feed, query) {
  return {
    query,
    count: feed.entries.length,
    source: feed.source,
    cached: Boolean(feed.cached),
    entries: feed.entries,
  };
}

export const TOOLS = [
  {
    name: 'search_reddit',
    title: 'Search Reddit',
    description:
      'Full-text search across Reddit, or within one subreddit when `subreddit` is set. Use this when looking for discussion of a topic rather than browsing a specific community. ' +
      FEED_CAVEAT,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        subreddit: {
          type: 'string',
          description: 'Optional: restrict the search to this subreddit, with or without the r/ prefix.',
        },
        sort: { type: 'string', enum: SEARCH_SORTS, description: 'Result ordering. Default relevance.' },
        time: { type: 'string', enum: TIME_RANGES, description: 'Time window. Default all.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results, default 25.' },
      },
      required: ['query'],
    },
    outputSchema: LISTING_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, env, ctx) {
      const query = String(args.query ?? '').trim();
      if (!query) throw new Error('query must not be empty.');
      const sort = pickOption(args.sort, SEARCH_SORTS, 'relevance', 'sort');
      const time = pickOption(args.time, TIME_RANGES, 'all', 'time');
      const limit = clampLimit(args.limit);

      let path = '/search.rss';
      const params = { q: query, sort, t: time, limit };
      if (args.subreddit) {
        const sub = validateSubreddit(args.subreddit);
        path = `/r/${sub}/search.rss`;
        params.restrict_sr = '1';
      }

      const feed = await fetchFeed(buildFeedUrl(path, params), env, ctx);
      const scope = args.subreddit ? ` in r/${validateSubreddit(args.subreddit)}` : '';
      return {
        text: renderListing(
          `Search: "${query}"${scope}`,
          feed,
          `Sorted by ${sort}, time range ${time}.`,
        ),
        structured: structuredListing(feed, query),
      };
    },
  },

  {
    name: 'browse_subreddit',
    title: 'Browse a subreddit',
    description:
      'List posts from one subreddit by hot, new, top, rising, or controversial. Use this to see what a community is discussing right now. ' +
      FEED_CAVEAT,
    inputSchema: {
      type: 'object',
      properties: {
        subreddit: { type: 'string', description: 'Subreddit name, with or without the r/ prefix.' },
        sort: { type: 'string', enum: SORTS, description: 'Listing order. Default hot.' },
        time: {
          type: 'string',
          enum: TIME_RANGES,
          description: 'Time window; applies to top and controversial. Default day.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max posts, default 25.' },
      },
      required: ['subreddit'],
    },
    outputSchema: LISTING_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, env, ctx) {
      const sub = validateSubreddit(args.subreddit);
      const sort = pickOption(args.sort, SORTS, 'hot', 'sort');
      const time = pickOption(args.time, TIME_RANGES, 'day', 'time');
      const limit = clampLimit(args.limit);

      const params = { limit };
      if (sort === 'top' || sort === 'controversial') params.t = time;

      const feed = await fetchFeed(buildFeedUrl(`/r/${sub}/${sort}.rss`, params), env, ctx);
      return {
        text: renderListing(`r/${sub} — ${sort}`, feed),
        structured: structuredListing(feed, `r/${sub}/${sort}`),
      };
    },
  },

  {
    name: 'get_thread',
    title: 'Read a thread',
    description:
      'Fetch one post and its comments. Accepts a reddit.com permalink, a t3_ thing ID, or a bare post ID. Use this after a search to read what people actually said. Comments arrive flat and unscored, so treat ordering as chronological rather than as consensus.',
    inputSchema: {
      type: 'object',
      properties: {
        post: {
          type: 'string',
          description: 'Permalink URL, t3_<id> thing ID, or bare base-36 post ID.',
        },
        sort: {
          type: 'string',
          enum: ['confidence', 'top', 'new', 'controversial', 'old', 'qa'],
          description: 'Comment ordering requested from Reddit. Default confidence (Reddit\'s "best").',
        },
        comment_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Max comments to return, default 25.',
        },
      },
      required: ['post'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        post: { type: 'object', properties: ENTRY_PROPERTIES },
        comment_count: { type: 'integer' },
        comments: { type: 'array', items: { type: 'object', properties: ENTRY_PROPERTIES } },
        source: { type: 'string' },
        cached: { type: 'boolean' },
      },
      required: ['comment_count', 'comments'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, env, ctx) {
      const postId = extractPostId(args.post);
      const sort = pickOption(
        args.sort,
        ['confidence', 'top', 'new', 'controversial', 'old', 'qa'],
        'confidence',
        'sort',
      );
      const limit = clampLimit(args.comment_limit);

      const feed = await fetchFeed(
        buildFeedUrl(`/comments/${postId}.rss`, { sort, limit }),
        env,
        ctx,
      );

      // Comment feeds normally contain only t1_ entries, with the post title at
      // feed level. Some responses include the post itself; handle both.
      const post = feed.entries.find((entry) => entry.type === 'post') || null;
      const comments = feed.entries.filter((entry) => entry.type !== 'post').slice(0, limit);

      const heading = post?.title || feed.title || `Post ${postId}`;
      const parts = [`## ${heading}`];
      if (post?.body) parts.push('', post.body);
      if (post?.url || feed.source) parts.push('', post?.url || `https://www.reddit.com/comments/${postId}`);

      parts.push('', `### ${comments.length} comment${comments.length === 1 ? '' : 's'}`);
      if (comments.length === 0) {
        parts.push('', 'No comments returned. The thread may be empty, locked, or removed.');
      } else {
        parts.push(
          '',
          ...comments.map((comment, i) => {
            const who = comment.author ? `u/${comment.author}` : 'unknown';
            const when = comment.published ? ` · ${comment.published.slice(0, 10)}` : '';
            return `**${i + 1}. ${who}**${when}\n\n${comment.body || '(empty)'}`;
          }),
        );
      }
      parts.push('', `_${FEED_CAVEAT}_`);

      return {
        text: parts.join('\n\n'),
        structured: {
          post,
          comment_count: comments.length,
          comments,
          source: feed.source,
          cached: Boolean(feed.cached),
        },
      };
    },
  },

  {
    name: 'get_user_activity',
    title: 'Read a user\'s public activity',
    description:
      'List a Reddit user\'s recent public posts and comments. Only public activity is visible. ' +
      FEED_CAVEAT,
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Username, with or without the u/ prefix.' },
        kind: {
          type: 'string',
          enum: ['overview', 'submitted', 'comments'],
          description: 'overview mixes both; submitted is posts only; comments is comments only. Default overview.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max items, default 25.' },
      },
      required: ['username'],
    },
    outputSchema: LISTING_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, env, ctx) {
      const username = validateUsername(args.username);
      const kind = pickOption(args.kind, ['overview', 'submitted', 'comments'], 'overview', 'kind');
      const limit = clampLimit(args.limit);

      const path = kind === 'overview' ? `/user/${username}.rss` : `/user/${username}/${kind}.rss`;
      const feed = await fetchFeed(buildFeedUrl(path, { limit }), env, ctx);
      return {
        text: renderListing(`u/${username} — ${kind}`, feed),
        structured: structuredListing(feed, `u/${username}/${kind}`),
      };
    },
  },

  {
    name: 'find_subreddits',
    title: 'Find subreddits',
    description:
      'Search for communities by name or topic. Use this first when you do not yet know which subreddit discusses something, then browse or search within the ones it returns.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic or community name to search for.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max communities, default 25.' },
      },
      required: ['query'],
    },
    outputSchema: LISTING_OUTPUT,
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, env, ctx) {
      const query = String(args.query ?? '').trim();
      if (!query) throw new Error('query must not be empty.');
      const limit = clampLimit(args.limit);

      const feed = await fetchFeed(
        buildFeedUrl('/subreddits/search.rss', { q: query, limit }),
        env,
        ctx,
      );
      return {
        text: renderListing(`Subreddits matching "${query}"`, feed),
        structured: structuredListing(feed, query),
      };
    },
  },
];

/** @type {Map<string, typeof TOOLS[number]>} */
export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Tool descriptors as sent over the wire, without the handler function. */
export function toolDescriptors() {
  return TOOLS.map(({ handler, ...descriptor }) => descriptor);
}

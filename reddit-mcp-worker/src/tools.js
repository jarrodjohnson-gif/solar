/**
 * MCP tool definitions and handlers.
 *
 * Each tool returns both a readable text rendering (what the model actually
 * reads) and `structuredContent` matching its declared `outputSchema` (what
 * a programmatic client can consume). The MCP spec requires the structured
 * field whenever an output schema is declared.
 *
 * Results carry `format`: "json" when Reddit served scores and threading,
 * "rss" when it refused and the read fell back. Renderers show scores when
 * they exist and stay silent about them when they don't, so the model is
 * never invited to infer ranking that isn't in the data.
 */

import {
  SORTS,
  SEARCH_SORTS,
  TIME_RANGES,
  clampLimit,
  extractPostId,
  fetchListing,
  pickOption,
  validateSubreddit,
  validateUsername,
} from './reddit.js';

const COMMENT_SORTS = ['confidence', 'top', 'new', 'controversial', 'old', 'qa'];

/**
 * Say what the data supports, which differs by the path that answered.
 * @param {object} feed
 * @returns {string}
 */
function caveatFor(feed) {
  if (feed.format === 'json') {
    return 'Served from Reddit public JSON: vote scores and comment counts are real values from Reddit.';
  }
  return 'Served from Reddit public RSS: no vote scores or comment counts, and comment lists are flat rather than threaded. Do not describe any result as top-voted or infer consensus from ordering.';
}

const ENTRY_PROPERTIES = {
  id: { type: 'string', description: 'Reddit base-36 ID' },
  type: { type: 'string', description: 'post, comment, or subreddit' },
  title: { type: 'string' },
  author: { type: 'string', description: 'Username without the u/ prefix' },
  subreddit: { type: 'string' },
  url: { type: 'string' },
  published: { type: 'string', description: 'ISO 8601 timestamp' },
  body: { type: 'string', description: 'Plain text' },
  score: { type: 'integer', description: 'Net votes. Absent on the RSS fallback.' },
  num_comments: { type: 'integer', description: 'Absent on the RSS fallback.' },
  upvote_ratio: { type: 'number', description: 'Absent on the RSS fallback.' },
  depth: { type: 'integer', description: 'Reply nesting level. Absent on the RSS fallback.' },
};

const LISTING_OUTPUT = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    count: { type: 'integer' },
    format: { type: 'string', enum: ['json', 'rss'], description: 'Which Reddit surface answered' },
    ranked: { type: 'boolean', description: 'True when vote scores were available' },
    source: { type: 'string', description: 'The Reddit URL that was read' },
    cached: { type: 'boolean' },
    entries: { type: 'array', items: { type: 'object', properties: ENTRY_PROPERTIES } },
  },
  required: ['count', 'entries', 'format'],
};

/**
 * Compact "42 points · 7 comments" line, omitted entirely when unavailable.
 * @param {object} entry
 * @returns {string}
 */
function renderStats(entry) {
  const bits = [];
  if (typeof entry.score === 'number') {
    bits.push(`${entry.score} point${entry.score === 1 ? '' : 's'}`);
  }
  if (typeof entry.num_comments === 'number') {
    bits.push(`${entry.num_comments} comment${entry.num_comments === 1 ? '' : 's'}`);
  }
  if (typeof entry.upvote_ratio === 'number') {
    bits.push(`${Math.round(entry.upvote_ratio * 100)}% upvoted`);
  }
  return bits.join(' · ');
}

/**
 * @param {object} entry
 * @param {number} index
 * @returns {string}
 */
function renderEntry(entry, index) {
  const lines = [];
  const heading = entry.title || `${entry.type} by u/${entry.author || 'unknown'}`;
  lines.push(`### ${index}. ${heading}`);

  const meta = [];
  const stats = renderStats(entry);
  if (stats) meta.push(stats);
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
    parts.push('', 'No results. Reddit returned an empty listing for this query.');
  } else {
    parts.push('', ...feed.entries.map((entry, i) => renderEntry(entry, i + 1)));
  }
  parts.push('', `_${caveatFor(feed)}_`);
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
    format: feed.format,
    ranked: feed.entries.some((entry) => typeof entry.score === 'number'),
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
      'Full-text search across Reddit, or within one subreddit when `subreddit` is set. Use this when looking for discussion of a topic rather than browsing a specific community. Results include vote scores when Reddit serves them.',
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

      const params = { q: query, sort, t: time, limit };
      let basePath = '/search';
      let scope = '';
      if (args.subreddit) {
        const sub = validateSubreddit(args.subreddit);
        basePath = `/r/${sub}/search`;
        params.restrict_sr = '1';
        scope = ` in r/${sub}`;
      }

      const feed = await fetchListing(basePath, params, env, ctx);
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
      'List posts from one subreddit by hot, new, top, rising, or controversial. Use this to see what a community is discussing. Results include vote scores when Reddit serves them.',
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

      const feed = await fetchListing(`/r/${sub}/${sort}`, params, env, ctx);
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
      'Fetch one post and its comments. Accepts a reddit.com permalink, a t3_ thing ID, or a bare post ID. Use this after a search to read what people actually said. When Reddit serves scores, comments carry point counts and reply nesting, and `sort: "top"` ranks them by score.',
    inputSchema: {
      type: 'object',
      properties: {
        post: {
          type: 'string',
          description: 'Permalink URL, t3_<id> thing ID, or bare base-36 post ID.',
        },
        sort: {
          type: 'string',
          enum: COMMENT_SORTS,
          description:
            'Comment ordering. "top" ranks by score, "confidence" is Reddit\'s "best". Default confidence.',
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
        format: { type: 'string', enum: ['json', 'rss'] },
        ranked: { type: 'boolean', description: 'True when comments carry vote scores' },
        comments: { type: 'array', items: { type: 'object', properties: ENTRY_PROPERTIES } },
        source: { type: 'string' },
        cached: { type: 'boolean' },
      },
      required: ['comment_count', 'comments', 'format'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(args, env, ctx) {
      const postId = extractPostId(args.post);
      const sort = pickOption(args.sort, COMMENT_SORTS, 'confidence', 'sort');
      const limit = clampLimit(args.comment_limit);

      const feed = await fetchListing(`/comments/${postId}`, { sort, limit }, env, ctx);

      // The JSON path separates the post for us; the RSS path returns only
      // comment entries with the title at feed level.
      const post = feed.post || feed.entries.find((entry) => entry.type === 'post') || null;
      let comments = feed.entries.filter((entry) => entry.type !== 'post');

      // Reddit already returns the requested order, but with real scores in
      // hand we can guarantee it rather than trust it.
      const ranked = comments.some((comment) => typeof comment.score === 'number');
      if (ranked && sort === 'top') {
        comments = [...comments].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }
      comments = comments.slice(0, limit);

      const heading = post?.title || feed.title || `Post ${postId}`;
      const parts = [`## ${heading}`];
      const postStats = post ? renderStats(post) : '';
      if (postStats) parts.push(postStats);
      if (post?.body) parts.push('', post.body);
      parts.push('', post?.url || `https://www.reddit.com/comments/${postId}`);

      const label = ranked && sort === 'top' ? ', ranked by score' : '';
      parts.push('', `### ${comments.length} comment${comments.length === 1 ? '' : 's'}${label}`);

      if (comments.length === 0) {
        parts.push('', 'No comments returned. The thread may be empty, locked, or removed.');
      } else {
        parts.push(
          '',
          ...comments.map((comment, i) => {
            const who = comment.author ? `u/${comment.author}` : 'unknown';
            const bits = [renderStats(comment), comment.published?.slice(0, 10)].filter(Boolean);
            const meta = bits.length ? ` — ${bits.join(' · ')}` : '';
            const indent = '  '.repeat(Math.min(comment.depth ?? 0, 5));
            const body = (comment.body || '(empty)')
              .split('\n')
              .map((line) => (indent ? indent + line : line))
              .join('\n');
            return `**${i + 1}. ${who}**${meta}\n\n${body}`;
          }),
        );
      }
      parts.push('', `_${caveatFor(feed)}_`);

      return {
        text: parts.join('\n\n'),
        structured: {
          post,
          comment_count: comments.length,
          format: feed.format,
          ranked,
          comments,
          source: feed.source,
          cached: Boolean(feed.cached),
        },
      };
    },
  },

  {
    name: 'get_user_activity',
    title: "Read a user's public activity",
    description:
      "List a Reddit user's recent public posts and comments. Only public activity is visible.",
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Username, with or without the u/ prefix.' },
        kind: {
          type: 'string',
          enum: ['overview', 'submitted', 'comments'],
          description:
            'overview mixes both; submitted is posts only; comments is comments only. Default overview.',
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

      const basePath = kind === 'overview' ? `/user/${username}` : `/user/${username}/${kind}`;
      const feed = await fetchListing(basePath, { limit }, env, ctx);
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

      const feed = await fetchListing('/subreddits/search', { q: query, limit }, env, ctx);
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

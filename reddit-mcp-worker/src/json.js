/**
 * Reddit JSON listing parser.
 *
 * Reddit's `.json` endpoints mirror every `.rss` path but carry what RSS drops:
 * vote scores, comment counts, upvote ratios, and real reply nesting. They are
 * part of the public web surface rather than the priced Data API, so they need
 * no credentials — but Reddit does refuse them from some IP ranges, which is
 * why every caller here falls back to RSS.
 *
 * Entries are normalised to the same shape `atom.js` produces, with the extra
 * fields appended, so tools can render either source without branching.
 */

/** Reddit thing kinds we render; `more` placeholders and everything else are skipped. */
const KIND_LABELS = {
  t1: 'comment',
  t3: 'post',
  t5: 'subreddit',
};

/**
 * @param {number|undefined} createdUtc
 * @returns {string} ISO 8601, or empty when absent
 */
function toIso(createdUtc) {
  if (typeof createdUtc !== 'number' || !Number.isFinite(createdUtc)) return '';
  return new Date(createdUtc * 1000).toISOString();
}

/**
 * @param {string} permalink
 * @returns {string}
 */
function toUrl(permalink) {
  if (!permalink) return '';
  if (/^https?:\/\//i.test(permalink)) return permalink;
  return `https://www.reddit.com${permalink}`;
}

/**
 * Normalise one `{kind, data}` thing.
 *
 * @param {{kind?: string, data?: object}} thing
 * @param {number} [depth]
 * @returns {object|null} null for kinds that carry no readable content
 */
export function parseThing(thing, depth = 0) {
  const kind = thing?.kind;
  const data = thing?.data;
  if (!data || !KIND_LABELS[kind]) return null;

  const type = KIND_LABELS[kind];
  const body = type === 'comment' ? data.body : data.selftext;

  const entry = {
    id: data.id || '',
    thingId: data.name || (data.id ? `${kind}_${data.id}` : ''),
    type,
    title: data.title || '',
    author: data.author && data.author !== '[deleted]' ? data.author : '',
    subreddit: data.subreddit || data.display_name || '',
    url: toUrl(data.permalink || data.url || ''),
    published: toIso(data.created_utc),
    updated: toIso(data.edited && typeof data.edited === 'number' ? data.edited : data.created_utc),
    body: typeof body === 'string' ? body.trim() : '',
  };

  // The fields RSS cannot provide. Left undefined rather than zero when Reddit
  // omits them, so "no score" stays distinguishable from "score of zero".
  if (typeof data.score === 'number') entry.score = data.score;
  if (typeof data.num_comments === 'number') entry.num_comments = data.num_comments;
  if (typeof data.upvote_ratio === 'number') entry.upvote_ratio = data.upvote_ratio;
  if (typeof data.subscribers === 'number') entry.subscribers = data.subscribers;
  if (data.link_flair_text) entry.flair = data.link_flair_text;
  if (data.stickied) entry.stickied = true;
  if (type === 'comment') {
    entry.depth = typeof data.depth === 'number' ? data.depth : depth;
    if (data.parent_id) entry.parent_id = data.parent_id;
  }

  return entry;
}

/**
 * Parse a `Listing` object into normalised entries.
 *
 * @param {object} listing
 * @returns {object[]}
 */
export function parseListing(listing) {
  const children = listing?.data?.children;
  if (!Array.isArray(children)) return [];
  return children.map((child) => parseThing(child)).filter((entry) => entry !== null);
}

/**
 * Flatten a comment tree depth-first, preserving reply order and recording
 * nesting depth so a renderer can indent without walking the tree itself.
 *
 * @param {object} listing
 * @param {number} [depth]
 * @returns {object[]}
 */
export function flattenComments(listing, depth = 0) {
  const children = listing?.data?.children;
  if (!Array.isArray(children)) return [];

  const out = [];
  for (const child of children) {
    const entry = parseThing(child, depth);
    if (!entry) continue; // `more` placeholders and deleted stubs
    out.push(entry);

    const replies = child.data?.replies;
    if (replies && typeof replies === 'object') {
      out.push(...flattenComments(replies, depth + 1));
    }
  }
  return out;
}

/**
 * Parse a top-level `.json` response, which is a Listing for feeds and a
 * two-element array (post, comments) for a comment page.
 *
 * @param {unknown} payload
 * @returns {{title: string, entries: object[], post: object|null}}
 */
export function parseJsonResponse(payload) {
  if (Array.isArray(payload)) {
    const [postListing, commentListing] = payload;
    const posts = parseListing(postListing);
    const post = posts[0] || null;
    return {
      title: post?.title || '',
      post,
      entries: flattenComments(commentListing),
    };
  }

  if (payload && payload.kind === 'Listing') {
    return { title: '', post: null, entries: parseListing(payload) };
  }

  return { title: '', post: null, entries: [] };
}

/**
 * True when a payload looks like something Reddit's JSON API produced, as
 * opposed to an error page or an interstitial served to a blocked client.
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
export function looksLikeRedditJson(payload) {
  if (Array.isArray(payload)) {
    return payload.length > 0 && payload.every((part) => part?.kind === 'Listing');
  }
  return payload?.kind === 'Listing';
}

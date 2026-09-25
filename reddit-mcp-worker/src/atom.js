/**
 * Minimal Atom parser for Reddit's RSS feeds, plus HTML-to-text conversion.
 *
 * Reddit serves Atom (not RSS 2.0) from every `.rss` endpoint. Entry bodies
 * arrive as HTML escaped inside the XML, so text extraction decodes twice:
 * once out of XML, once out of HTML.
 *
 * Workers have no DOMParser, and pulling in an XML library for a feed shape
 * this predictable would cost more than it's worth. These are targeted
 * extractors, defensive about missing fields rather than fully general.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/**
 * Decode XML/HTML entities, including decimal and hex numeric references.
 * @param {string} input
 * @returns {string}
 */
export function decodeEntities(input) {
  if (!input) return '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Convert a fragment of Reddit-flavoured HTML into readable plain text,
 * preserving paragraph breaks, list markers, blockquotes, and link targets.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  if (!html) return '';
  let text = html;

  // Reddit wraps every rendered body in these markers.
  text = text.replace(/<!--\s*SC_O(FF|N)\s*-->/g, '');

  text = text.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*(p|div|h[1-6]|tr)\s*>/gi, '\n\n');
  text = text.replace(/<\s*li[^>]*>/gi, '\n- ');
  text = text.replace(/<\s*\/\s*li\s*>/gi, '');
  text = text.replace(/<\s*blockquote[^>]*>/gi, '\n> ');
  text = text.replace(/<\s*\/\s*blockquote\s*>/gi, '\n');

  // Keep the destination when the anchor text doesn't already contain it.
  text = text.replace(
    /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href, label) => {
      const cleanLabel = label.replace(/<[^>]+>/g, '').trim();
      const cleanHref = decodeEntities(href).trim();
      if (!cleanLabel) return cleanHref;
      if (cleanLabel === cleanHref) return cleanLabel;
      return `${cleanLabel} (${cleanHref})`;
    },
  );

  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);

  // Collapse the whitespace the tag removal leaves behind.
  text = text.replace(/[ \t ]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Reddit appends a navigation footer to every entry body. It's noise for a
 * model reading the text, and it repeats metadata the entry already carries.
 * @param {string} text
 * @returns {string}
 */
export function stripRedditFooter(text) {
  if (!text) return '';
  return text
    .replace(/\n?submitted by\s+\/u\/\S+.*$/is, '')
    .replace(/\[link\]\s*\(\S+\)/gi, '')
    .replace(/\[comments\]\s*\(\S+\)/gi, '')
    .replace(/\n?\[link\]\s*\[comments\]\s*$/i, '')
    .trim();
}

/**
 * Pull the text content of the first matching child tag.
 * @param {string} xml
 * @param {string} tag
 * @returns {string}
 */
function tagText(xml, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(pattern);
  if (!match) return '';
  let value = match[1];
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1];
  return decodeEntities(value).trim();
}

/**
 * Read an attribute off the first matching tag, tolerating any attribute order.
 * @param {string} xml
 * @param {string} tag
 * @param {string} attr
 * @returns {string}
 */
function tagAttr(xml, tag, attr) {
  const pattern = new RegExp(`<${tag}\\s[^>]*${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const match = xml.match(pattern);
  return match ? decodeEntities(match[1]).trim() : '';
}

/**
 * Reddit thing IDs are prefixed by kind: t1_ comment, t3_ post, t5_ subreddit.
 * @param {string} id
 * @returns {{kind: string, id: string}}
 */
export function splitThingId(id) {
  const match = /^(t\d)_([a-z0-9]+)$/i.exec(id || '');
  if (!match) return { kind: '', id: id || '' };
  return { kind: match[1].toLowerCase(), id: match[2] };
}

const KIND_LABELS = {
  t1: 'comment',
  t3: 'post',
  t5: 'subreddit',
};

/**
 * Parse a single <entry> block.
 * @param {string} xml
 * @returns {object}
 */
export function parseEntry(xml) {
  const rawId = tagText(xml, 'id');
  const { kind, id } = splitThingId(rawId);
  const authorBlock = xml.match(/<author>([\s\S]*?)<\/author>/i);
  const author = authorBlock ? tagText(authorBlock[1], 'name') : '';
  const rawContent = tagText(xml, 'content');
  const body = stripRedditFooter(htmlToText(rawContent));

  return {
    id,
    thingId: rawId,
    type: KIND_LABELS[kind] || 'unknown',
    title: tagText(xml, 'title'),
    author: author.replace(/^\/u\//, ''),
    subreddit: tagAttr(xml, 'category', 'term'),
    url: tagAttr(xml, 'link', 'href'),
    published: tagText(xml, 'published') || tagText(xml, 'updated'),
    updated: tagText(xml, 'updated'),
    body,
  };
}

/**
 * Parse a Reddit Atom feed into a feed header plus entries.
 * @param {string} xml
 * @returns {{title: string, subtitle: string, updated: string, entries: object[]}}
 */
export function parseFeed(xml) {
  if (!xml || !/<feed[\s>]/i.test(xml)) {
    return { title: '', subtitle: '', updated: '', entries: [] };
  }

  const entries = [];
  const entryPattern = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryPattern.exec(xml)) !== null) {
    entries.push(parseEntry(match[1]));
  }

  // Strip entries before reading feed-level tags so the first <title> found
  // is the feed's own, not an entry's.
  const header = xml.replace(entryPattern, '');
  return {
    title: tagText(header, 'title'),
    subtitle: tagText(header, 'subtitle'),
    updated: tagText(header, 'updated'),
    entries,
  };
}

/** A Reddit Atom listing feed, shaped as Reddit actually serves it. */
export const LISTING_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<category term="laundry" label="r/laundry"/>
<updated>2026-09-10T12:00:00+00:00</updated>
<id>/r/laundry/.rss</id>
<title>Laundry</title>
<subtitle>All things laundry</subtitle>
<entry>
  <author><name>/u/soapfan</name><uri>https://www.reddit.com/user/soapfan</uri></author>
  <category term="laundry" label="r/laundry"/>
  <content type="html">&lt;!-- SC_OFF --&gt;&lt;div class="md"&gt;&lt;p&gt;I add &lt;strong&gt;citric acid&lt;/strong&gt; to the rinse only.&lt;/p&gt;&lt;p&gt;Never with detergent &amp;amp; never hot.&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &lt;a href="https://www.reddit.com/r/laundry/comments/abc123/x/"&gt;[link]&lt;/a&gt; &lt;a href="https://www.reddit.com/r/laundry/comments/abc123/x/"&gt;[comments]&lt;/a&gt;</content>
  <id>t3_abc123</id>
  <link href="https://www.reddit.com/r/laundry/comments/abc123/citric_acid_routine/"/>
  <updated>2026-09-10T11:00:00+00:00</updated>
  <published>2026-09-10T11:00:00+00:00</published>
  <title>Citric acid routine</title>
</entry>
<entry>
  <author><name>/u/enzymes</name><uri>https://www.reddit.com/user/enzymes</uri></author>
  <category term="laundry" label="r/laundry"/>
  <content type="html">&lt;!-- SC_OFF --&gt;&lt;div class="md"&gt;&lt;ul&gt;&lt;li&gt;Warm water&lt;/li&gt;&lt;li&gt;Long soak&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt;</content>
  <id>t3_def456</id>
  <link href="https://www.reddit.com/r/laundry/comments/def456/enzyme_tips/"/>
  <updated>2026-09-09T08:30:00+00:00</updated>
  <published>2026-09-09T08:30:00+00:00</published>
  <title>Enzyme tips</title>
</entry>
</feed>`;

/** A comments feed: entries are t1_ comments, post title lives at feed level. */
export const COMMENTS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>/comments/abc123.rss</id>
<title>Citric acid routine</title>
<updated>2026-09-10T12:00:00+00:00</updated>
<entry>
  <author><name>/u/rinsecycle</name></author>
  <category term="laundry" label="r/laundry"/>
  <content type="html">&lt;div class="md"&gt;&lt;p&gt;Rinse only. It kills the enzymes if you add it to the wash.&lt;/p&gt;&lt;/div&gt;</content>
  <id>t1_ccc111</id>
  <link href="https://www.reddit.com/r/laundry/comments/abc123/x/ccc111/"/>
  <published>2026-09-10T11:30:00+00:00</published>
  <updated>2026-09-10T11:30:00+00:00</updated>
  <title>/u/rinsecycle on Citric acid routine</title>
</entry>
<entry>
  <author><name>/u/hardwater</name></author>
  <category term="laundry" label="r/laundry"/>
  <content type="html">&lt;div class="md"&gt;&lt;p&gt;Also add a builder if you&amp;#39;re on hard water.&lt;/p&gt;&lt;/div&gt;</content>
  <id>t1_ccc222</id>
  <link href="https://www.reddit.com/r/laundry/comments/abc123/x/ccc222/"/>
  <published>2026-09-10T11:45:00+00:00</published>
  <updated>2026-09-10T11:45:00+00:00</updated>
  <title>/u/hardwater on Citric acid routine</title>
</entry>
</feed>`;

export const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><id>/r/empty/.rss</id><title>empty</title></feed>`;

/** A Reddit JSON listing, as the .json endpoints serve it. */
export const LISTING_JSON = JSON.stringify({
  kind: 'Listing',
  data: {
    children: [
      {
        kind: 't3',
        data: {
          id: 'abc123',
          name: 't3_abc123',
          title: 'Citric acid routine',
          author: 'soapfan',
          subreddit: 'laundry',
          permalink: '/r/laundry/comments/abc123/citric_acid_routine/',
          created_utc: 1757500000,
          selftext: 'I add citric acid to the rinse only.',
          score: 128,
          num_comments: 12,
          upvote_ratio: 0.97,
        },
      },
      {
        kind: 't3',
        data: {
          id: 'def456',
          name: 't3_def456',
          title: 'Enzyme tips',
          author: 'enzymes',
          subreddit: 'laundry',
          permalink: '/r/laundry/comments/def456/enzyme_tips/',
          created_utc: 1757400000,
          selftext: 'Warm water, long soak.',
          score: 7,
          num_comments: 2,
        },
      },
    ],
  },
});

/** A Reddit comments page: [post listing, comment listing] with nesting. */
export const COMMENTS_JSON = JSON.stringify([
  {
    kind: 'Listing',
    data: {
      children: [
        {
          kind: 't3',
          data: {
            id: 'abc123',
            name: 't3_abc123',
            title: 'Citric acid routine',
            author: 'soapfan',
            subreddit: 'laundry',
            permalink: '/r/laundry/comments/abc123/citric_acid_routine/',
            created_utc: 1757500000,
            selftext: 'I add citric acid to the rinse only.',
            score: 128,
            num_comments: 12,
          },
        },
      ],
    },
  },
  {
    kind: 'Listing',
    data: {
      children: [
        {
          kind: 't1',
          data: {
            id: 'ccc111',
            name: 't1_ccc111',
            author: 'lowscore',
            subreddit: 'laundry',
            body: 'Try vinegar instead.',
            score: 3,
            depth: 0,
            created_utc: 1757500100,
            permalink: '/r/laundry/comments/abc123/x/ccc111/',
            replies: {
              kind: 'Listing',
              data: {
                children: [
                  {
                    kind: 't1',
                    data: {
                      id: 'ccc333',
                      name: 't1_ccc333',
                      author: 'nested',
                      body: 'Vinegar is worse for seals.',
                      score: 11,
                      depth: 1,
                      parent_id: 't1_ccc111',
                      created_utc: 1757500200,
                      permalink: '/r/laundry/comments/abc123/x/ccc333/',
                      replies: '',
                    },
                  },
                ],
              },
            },
          },
        },
        {
          kind: 't1',
          data: {
            id: 'ccc222',
            name: 't1_ccc222',
            author: 'topvoted',
            subreddit: 'laundry',
            body: 'Rinse only. It kills the enzymes in the wash.',
            score: 94,
            depth: 0,
            created_utc: 1757500300,
            permalink: '/r/laundry/comments/abc123/x/ccc222/',
            replies: '',
          },
        },
        // `more` placeholders must be skipped, not rendered as empty comments.
        { kind: 'more', data: { count: 5, children: ['zzz999'] } },
      ],
    },
  },
]);

/**
 * Install a stub global fetch that records calls and answers by extension:
 * `.json` URLs get `json`, `.rss` URLs get `xml`.
 *
 * Pass `jsonStatus` to simulate Reddit refusing the JSON path, which is what
 * exercises the RSS fallback.
 *
 * @param {{json?: string, xml?: string, jsonStatus?: number, status?: number}} [options]
 */
export function stubFetch(options = {}) {
  const {
    json = LISTING_JSON,
    xml = LISTING_FEED,
    jsonStatus = 200,
    status = 200,
  } = typeof options === 'string' ? { xml: options } : options;

  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push({ url: href, init });
    const isJson = new URL(href).pathname.endsWith('.json');
    if (isJson) {
      return new Response(json, {
        status: jsonStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(xml, {
      status,
      headers: { 'Content-Type': 'application/atom+xml' },
    });
  };
  // Disable the edge cache so tests exercise the fetch path deterministically.
  globalThis.caches = undefined;
  return calls;
}

/** Shorthand: Reddit refuses JSON, so reads fall back to RSS. */
export function stubFetchRssOnly(xml = LISTING_FEED) {
  return stubFetch({ xml, jsonStatus: 403 });
}

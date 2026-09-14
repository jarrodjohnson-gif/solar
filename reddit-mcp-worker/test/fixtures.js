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

/**
 * Install a stub global fetch that returns `xml` and records calls.
 * @param {string} xml
 * @param {{status?: number}} [options]
 */
export function stubFetch(xml, options = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(xml, {
      status: options.status ?? 200,
      headers: { 'Content-Type': 'application/atom+xml' },
    });
  };
  // Disable the edge cache so tests exercise the fetch path deterministically.
  globalThis.caches = undefined;
  return calls;
}

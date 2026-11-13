import dns from 'node:dns/promises';
import net from 'node:net';
import type { ToolContext } from './registry';
import {
  decodeEntities,
  isPrivateAddress,
  stripHtml,
  truncate,
} from '../util';

export interface ResearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published?: string;
}

function clean(input: string): string {
  return decodeEntities(
    input
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlItems(xml: string): Array<{ title: string; link: string; description: string; pubDate?: string }> {
  const items: Array<{ title: string; link: string; description: string; pubDate?: string }> = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks) {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    const description = block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '';
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    if (title && link) {
      items.push({ title: clean(title), link: clean(link), description: clean(description), pubDate });
    }
  }
  return items;
}

async function timedFetch(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
  timeoutMs = 9000,
): Promise<Response> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  return fetch(url, {
    ...init,
    signal: combined,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function tavilySearch(
  query: string,
  max: number,
  key: string,
  signal: AbortSignal,
): Promise<ResearchResult[]> {
  const response = await timedFetch(
    'https://api.tavily.com/search',
    signal,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: max,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
      }),
    },
    12_000,
  );
  if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: truncate(clean(r.content ?? ''), 450),
      source: 'Tavily',
    }));
}

async function googleNews(query: string, signal: AbortSignal): Promise<ResearchResult[]> {
  const response = await timedFetch(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
    signal,
  );
  if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
  return xmlItems(await response.text())
    .slice(0, 8)
    .map((item) => ({
      title: item.title,
      url: item.link,
      snippet: truncate(item.description || 'News coverage. Open the source for detail.', 420),
      source: 'Google News',
      published: item.pubDate,
    }));
}

async function bingNews(query: string, signal: AbortSignal): Promise<ResearchResult[]> {
  const response = await timedFetch(
    `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
    signal,
  );
  if (!response.ok) throw new Error(`Bing News HTTP ${response.status}`);
  return xmlItems(await response.text())
    .slice(0, 6)
    .map((item) => ({
      title: item.title,
      url: item.link,
      snippet: truncate(item.description || 'News coverage.', 420),
      source: 'Bing News',
      published: item.pubDate,
    }));
}

async function hackerNews(query: string, signal: AbortSignal): Promise<ResearchResult[]> {
  const response = await timedFetch(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=6`,
    signal,
  );
  if (!response.ok) throw new Error(`Hacker News HTTP ${response.status}`);
  const data = (await response.json()) as {
    hits?: Array<{
      title?: string;
      url?: string;
      objectID?: string;
      points?: number;
      author?: string;
      created_at?: string;
      story_text?: string;
    }>;
  };
  return (data.hits ?? [])
    .filter((hit) => hit.title)
    .map((hit) => ({
      title: hit.title!,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      snippet: truncate(
        clean(
          `${hit.points ?? 0} points · ${hit.author ?? 'unknown'} · ${hit.created_at?.slice(0, 10) ?? ''} ${hit.story_text ?? ''}`,
        ),
        400,
      ),
      source: 'Hacker News',
      published: hit.created_at,
    }));
}

async function wikipedia(query: string, signal: AbortSignal): Promise<ResearchResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '4',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    inprop: 'url',
    format: 'json',
    origin: '*',
  });
  const response = await timedFetch(`https://en.wikipedia.org/w/api.php?${params}`, signal);
  if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
  const data = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; extract?: string; fullurl?: string; index?: number }
      >;
    };
  };
  return Object.values(data.query?.pages ?? {})
    .filter((page) => page.title && page.fullurl)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((page) => ({
      title: page.title!,
      url: page.fullurl!,
      snippet: truncate(clean(page.extract ?? ''), 450),
      source: 'Wikipedia',
    }));
}

async function semanticscholar(query: string, signal: AbortSignal): Promise<ResearchResult[]> {
  const params = new URLSearchParams({
    query,
    limit: '4',
    fields: 'title,abstract,url,year,authors',
  });
  const response = await timedFetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
    signal,
  );
  if (!response.ok) throw new Error(`Semantic Scholar HTTP ${response.status}`);
  const data = (await response.json()) as {
    data?: Array<{
      title?: string;
      abstract?: string;
      url?: string;
      year?: number;
      authors?: Array<{ name?: string }>;
    }>;
  };
  return (data.data ?? [])
    .filter((paper) => paper.title && paper.url)
    .map((paper) => ({
      title: paper.title!,
      url: paper.url!,
      snippet: truncate(
        `${paper.year ?? 'n.d.'} · ${(paper.authors ?? []).slice(0, 3).map((a) => a.name).join(', ')} — ${clean(paper.abstract ?? '')}`,
        450,
      ),
      source: 'Semantic Scholar',
    }));
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL. Provide a full http(s) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https URLs are allowed.');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Access to local or internal hosts is blocked.');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new Error('Access to private network addresses is blocked.');
    }
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Access to local or private network addresses is blocked.');
  }
  return url;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (received > maxBytes) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* noop */
    }
  }
  return text;
}

export async function webSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; summary: string }> {
  const query = String(args.query ?? '').trim();
  if (query.length < 2) throw new Error('Query must be at least 2 characters.');
  const max = Math.min(10, Math.max(1, Number(args.max_results ?? 6)));
  const tavilyKey = ctx.store.getTavilyKey();

  let results: ResearchResult[] = [];
  let engineNote = '';

  if (tavilyKey) {
    try {
      results = await tavilySearch(query, max, tavilyKey, ctx.signal);
      engineNote = 'Tavily';
    } catch {
      engineNote = '';
    }
  }

  if (!results.length) {
    const searches = await Promise.allSettled([
      googleNews(query, ctx.signal),
      hackerNews(query, ctx.signal),
      wikipedia(query, ctx.signal),
      bingNews(query, ctx.signal),
      semanticscholar(query, ctx.signal),
    ]);
    const sourceOrder = ['Google News', 'Hacker News', 'Bing News', 'Wikipedia', 'Semantic Scholar'];
    for (const settled of searches) {
      if (settled.status === 'fulfilled') results.push(...settled.value);
    }
    // Keep source diversity; cap news aggregator volume.
    const seen = new Set<string>();
    const deduped: ResearchResult[] = [];
    for (const result of results) {
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(result);
    }
    results = deduped
      .sort((a, b) => sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source))
      .slice(0, max);
    engineNote = 'Google News + Hacker News + Wikipedia + Bing News + Semantic Scholar';
  }

  const payload = {
    query,
    retrievedAt: new Date().toISOString(),
    engines: engineNote || 'none',
    resultCount: results.length,
    results: results.map((result) => ({
      title: truncate(clean(result.title), 160),
      url: result.url,
      snippet: truncate(clean(result.snippet), 420),
      source: result.source,
      ...(result.published ? { published: result.published } : {}),
    })),
    note:
      results.length === 0
        ? 'No results returned. Upstream search may be rate-limited; try a narrower query or fetch a known URL directly.'
        : 'These are retrieved extracts, not verified facts. Cross-check important claims before acting.',
  };

  return {
    content: JSON.stringify(payload, null, 2),
    summary: `${results.length} results · ${query}`,
  };
}

export async function fetchUrl(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; summary: string }> {
  const rawUrl = String(args.url ?? '').trim();
  const maxChars = Math.min(20_000, Math.max(500, Number(args.max_chars ?? 7000)));
  let url = await assertPublicUrl(rawUrl);

  let response: Response | undefined;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    response = await timedFetch(url.toString(), ctx.signal, { redirect: 'manual' }, 12_000);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) break;
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }
  if (!response) throw new Error('No response from target URL.');
  if (!response.ok) {
    throw new Error(`Target returned HTTP ${response.status} ${response.statusText}.`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/|application\/(json|xml|xhtml)/i.test(contentType)) {
    throw new Error(
      `Unsupported content type: ${contentType || 'unknown'}. Only text, HTML, JSON and XML are readable.`,
    );
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 6_000_000) {
    throw new Error('Response is too large to read (over 6 MB).');
  }

  const body = await readLimitedText(response, 4_000_000);
  let title = '';
  let extracted = '';

  if (/html|xhtml/i.test(contentType) || /<html/i.test(body.slice(0, 500))) {
    title = clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const meta = clean(
      body.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      )?.[1] ?? '',
    );
    extracted = stripHtml(body);
    if (meta && !extracted.includes(meta.slice(0, 60))) {
      extracted = `${meta}\n\n${extracted}`;
    }
  } else {
    extracted = body;
  }

  extracted = extracted.replace(/\n{3,}/g, '\n\n').trim();
  const truncated = extracted.length > maxChars;
  const text = truncated ? `${extracted.slice(0, maxChars)}…` : extracted;

  const payload = {
    url: url.toString(),
    title: title || url.hostname,
    fetchedAt: new Date().toISOString(),
    contentType,
    truncated,
    characters: text.length,
    content: text,
    note: truncated
      ? 'Content truncated. Increase max_chars or fetch a more specific page if needed.'
      : undefined,
  };

  return {
    content: JSON.stringify(payload, null, 2),
    summary: `${title || url.hostname} · ${text.length} chars`,
  };
}

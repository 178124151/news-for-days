import http from 'node:http';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const UA =
  'SignalDailyBot/1.0 (personal news digest; +https://github.com/178124151/news-for-days)';

export interface FetchResult {
  status: number;
  body: string;
  etag?: string;
  lastModified?: string;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// 本机可用 HTTPS_PROXY（如 127.0.0.1:7897）访问被墙的免费机翻端点；CI 无代理则直连。
const PROXY =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const proxyAgent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;

// 用 node:http 而不是 fetch：undici 在并发中断连接时会偶发断言崩溃
function rawRequest(
  urlStr: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; redirects?: number } = {},
): Promise<RawResponse> {
  const { method = 'GET', headers = {}, body, timeoutMs = 30000, redirects = 3 } = opts;
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch (err) {
      return reject(err);
    }
    const lib = url.protocol === 'https:' ? https : http;
    const ua = url.hostname.endsWith('sec.gov')
      ? 'SignalDaily/1.0 admin@signal-daily.example'
      : UA;
    const req = lib.request(
      url,
      {
        method,
        headers: { 'User-Agent': ua, 'Accept-Encoding': 'identity', ...headers },
        agent: proxyAgent && url.protocol === 'https:' ? proxyAgent : false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(rawRequest(next, { ...opts, redirects: redirects - 1 }));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const lastHit = new Map<string, number>();

// 遵守 1 req/s/域名 的礼貌抓取
async function polite(host: string) {
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; retries?: number; etag?: string; lastModified?: string } = {},
): Promise<FetchResult> {
  const { timeoutMs = 30000, retries = 1, etag, lastModified } = opts;
  const host = new URL(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await polite(host);
      const headers: Record<string, string> = {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      };
      if (etag) headers['If-None-Match'] = etag;
      if (lastModified) headers['If-Modified-Since'] = lastModified;
      const res = await rawRequest(url, { headers, timeoutMs });
      return {
        status: res.status,
        body: res.status === 304 ? '' : res.body,
        etag: (res.headers.etag as string) ?? undefined,
        lastModified: (res.headers['last-modified'] as string) ?? undefined,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1200);
    }
  }
  throw lastErr;
}

export async function requestJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<{ status: number; text: string }> {
  const res = await rawRequest(url, { ...opts, timeoutMs: opts.timeoutMs ?? 60000 });
  return { status: res.status, text: res.body };
}

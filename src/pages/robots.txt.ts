import type { APIRoute } from 'astro';
import { href } from '../lib/content.ts';

const SITE = import.meta.env.SITE ?? 'https://178124151.github.io';

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(href('sitemap.xml'), SITE)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

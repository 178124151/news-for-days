import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// 项目站点：https://178124151.github.io/news-for-days/
export default defineConfig({
  site: 'https://178124151.github.io',
  base: '/news-for-days',
  trailingSlash: 'always',
  build: { format: 'directory' },
  vite: { plugins: [tailwindcss()] },
});

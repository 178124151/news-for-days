import type { Category } from './schema.ts';

export const CAT_STYLE: Record<Category, { chip: string; bar: string; dot: string }> = {
  ai: {
    chip: 'text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-500/10 dark:border-violet-500/25',
    bar: 'bg-violet-500',
    dot: 'bg-violet-500',
  },
  tech: {
    chip: 'text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-500/10 dark:border-sky-500/25',
    bar: 'bg-sky-500',
    dot: 'bg-sky-500',
  },
  finance: {
    chip: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/25',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
  },
  policy: {
    chip: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-500/25',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
  },
};

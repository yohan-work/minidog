import { DEFAULT_TIME_RANGE, type TimeRange } from '@minidog/types';

/**
 * Carries the shared time range into a link. Kept free of client-only imports
 * so server components (the sidebar fallback) can use it.
 */
export function withRange(href: string, range: TimeRange): string {
  const [path = href, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  if (range === DEFAULT_TIME_RANGE) params.delete('range');
  else params.set('range', range);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

type Value = string | number | null | undefined;

/** Filters live in the URL so a view can be shared, reloaded and linked to. */
export function useQueryParams() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const get = useCallback((key: string) => searchParams.get(key) ?? '', [searchParams]);
  /** Every value of a repeatable parameter, e.g. `?attr=a&attr=b`. */
  const getAll = useCallback((key: string) => searchParams.getAll(key), [searchParams]);

  const set = useCallback(
    (patch: Record<string, Value | readonly string[]>) => {
      const params = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        params.delete(key);
        if (Array.isArray(value)) for (const item of value) params.append(key, item);
        else if (value) params.set(key, String(value));
      }
      const search = params.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { get, getAll, set };
}

/** `?a=1&b=2` from the non-empty entries; an array repeats its key. */
export function toQuery(params: Record<string, Value | readonly string[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) search.append(key, item);
    else if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

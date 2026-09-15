'use client';

import { useEffect, useState } from 'react';

/**
 * Increments whenever <html data-theme> changes. Components that read token
 * colors once (canvas charts) add it to their effect dependencies to redraw.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((current) => current + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return version;
}

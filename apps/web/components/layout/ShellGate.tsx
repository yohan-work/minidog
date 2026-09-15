'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** The sign-in page renders on its own, without the navigation it leads to. */
export function ShellGate({ full, bare }: { full: ReactNode; bare: ReactNode }) {
  return usePathname() === '/login' ? bare : full;
}

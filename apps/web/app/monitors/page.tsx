import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MonitorsView } from '@/features/monitors/MonitorsView';

export const metadata: Metadata = { title: 'Monitors' };

export default function MonitorsPage() {
  return (
    <Suspense>
      <MonitorsView />
    </Suspense>
  );
}

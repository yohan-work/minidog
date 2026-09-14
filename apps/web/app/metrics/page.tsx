import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MetricsView } from '@/features/metrics/MetricsView';

export const metadata: Metadata = { title: 'Metrics' };

export default function MetricsPage() {
  return (
    <Suspense>
      <MetricsView />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewMonitorView } from '@/features/synthetics/NewMonitorView';

export const metadata: Metadata = { title: 'New monitor' };

export default function NewMonitorPage() {
  return (
    <Suspense>
      <NewMonitorView />
    </Suspense>
  );
}

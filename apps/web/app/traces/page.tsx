import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TracesView } from '@/features/apm/TracesView';

export const metadata: Metadata = { title: 'Traces' };

export default function TracesPage() {
  return (
    <Suspense>
      <TracesView />
    </Suspense>
  );
}

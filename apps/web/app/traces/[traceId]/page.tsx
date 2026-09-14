import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TraceDetailView } from '@/features/apm/TraceDetailView';

export const metadata: Metadata = { title: 'Trace' };

export default async function TracePage({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  return (
    <Suspense>
      <TraceDetailView key={traceId} traceId={traceId.toLowerCase()} />
    </Suspense>
  );
}

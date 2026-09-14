import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MonitorDetailView } from '@/features/synthetics/MonitorDetailView';

export const metadata: Metadata = { title: 'Monitor' };

export default async function MonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      {/* key resets view state when navigating between monitors */}
      <MonitorDetailView key={id} id={id} />
    </Suspense>
  );
}

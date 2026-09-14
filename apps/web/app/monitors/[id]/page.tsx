import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AlertMonitorDetailView } from '@/features/monitors/AlertMonitorDetailView';

export const metadata: Metadata = { title: 'Monitor' };

export default async function AlertMonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      {/* key resets view state when navigating between monitors */}
      <AlertMonitorDetailView key={id} id={id} />
    </Suspense>
  );
}

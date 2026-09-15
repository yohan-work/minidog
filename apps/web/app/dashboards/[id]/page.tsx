import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardView } from '@/features/dashboards/DashboardView';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      {/* key resets edits when navigating between dashboards */}
      <DashboardView key={id} id={id} />
    </Suspense>
  );
}

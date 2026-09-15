import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardsView } from '@/features/dashboards/DashboardsView';

export const metadata: Metadata = { title: 'Dashboards' };

export default function DashboardsPage() {
  return (
    <Suspense>
      <DashboardsView />
    </Suspense>
  );
}

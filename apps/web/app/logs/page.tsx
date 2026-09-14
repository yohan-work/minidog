import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LogsView } from '@/features/logs/LogsView';

export const metadata: Metadata = { title: 'Logs' };

export default function LogsPage() {
  return (
    <Suspense>
      <LogsView />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QueriesView } from '@/features/queries/QueriesView';

export const metadata: Metadata = { title: 'Database queries' };

export default function QueriesPage() {
  return (
    <Suspense>
      <QueriesView />
    </Suspense>
  );
}

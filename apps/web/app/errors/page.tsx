import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ErrorsView } from '@/features/errors/ErrorsView';

export const metadata: Metadata = { title: 'Errors' };

export default function ErrorsPage() {
  return (
    <Suspense>
      <ErrorsView />
    </Suspense>
  );
}

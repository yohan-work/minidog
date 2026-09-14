import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InfrastructureView } from '@/features/infrastructure/InfrastructureView';

export const metadata: Metadata = { title: 'Infrastructure' };

export default function InfrastructurePage() {
  return (
    <Suspense>
      <InfrastructureView />
    </Suspense>
  );
}

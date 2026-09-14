import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ServicesView } from '@/features/apm/ServicesView';

export const metadata: Metadata = { title: 'Services' };

export default function ServicesPage() {
  return (
    <Suspense>
      <ServicesView />
    </Suspense>
  );
}

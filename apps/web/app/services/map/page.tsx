import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ServiceMapView } from '@/features/apm/ServiceMapView';

export const metadata: Metadata = { title: 'Service map' };

export default function ServiceMapPage() {
  return (
    <Suspense>
      <ServiceMapView />
    </Suspense>
  );
}

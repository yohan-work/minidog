import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ServiceDetailView } from '@/features/apm/ServiceDetailView';
import { safeDecode } from '@/lib/safe-decode';

export const metadata: Metadata = { title: 'Service' };

export default async function ServicePage({ params }: { params: Promise<{ service: string }> }) {
  const service = safeDecode((await params).service);
  return (
    <Suspense>
      {/* key resets view state when navigating between services */}
      <ServiceDetailView key={service} service={service} />
    </Suspense>
  );
}

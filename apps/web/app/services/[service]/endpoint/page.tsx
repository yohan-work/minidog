import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EndpointDetailView } from '@/features/apm/EndpointDetailView';
import { safeDecode } from '@/lib/safe-decode';

export const metadata: Metadata = { title: 'Endpoint' };

export default async function EndpointPage({ params }: { params: Promise<{ service: string }> }) {
  const service = safeDecode((await params).service);
  return (
    <Suspense>
      {/* key resets view state when navigating between services; the endpoint is ?e= */}
      <EndpointDetailView key={service} service={service} />
    </Suspense>
  );
}

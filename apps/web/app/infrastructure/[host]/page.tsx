import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HostDetailView } from '@/features/infrastructure/HostDetailView';
import { safeDecode } from '@/lib/safe-decode';

export const metadata: Metadata = { title: 'Host' };

export default async function HostPage({ params }: { params: Promise<{ host: string }> }) {
  const host = safeDecode((await params).host);
  return (
    <Suspense>
      {/* key resets view state when navigating between hosts */}
      <HostDetailView key={host} host={host} />
    </Suspense>
  );
}

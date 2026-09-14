import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SyntheticsView } from '@/features/synthetics/SyntheticsView';

export const metadata: Metadata = { title: 'Synthetics' };

export default function SyntheticsPage() {
  return (
    <Suspense>
      <SyntheticsView />
    </Suspense>
  );
}

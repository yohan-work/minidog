import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewAlertMonitorView } from '@/features/monitors/NewAlertMonitorView';

export const metadata: Metadata = { title: 'New monitor' };

export default function NewAlertMonitorPage() {
  return (
    <Suspense>
      <NewAlertMonitorView />
    </Suspense>
  );
}

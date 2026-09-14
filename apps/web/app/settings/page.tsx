import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettingsView } from '@/features/settings/SettingsView';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}

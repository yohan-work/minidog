import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginView } from '@/features/auth/LoginView';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginView />
    </Suspense>
  );
}

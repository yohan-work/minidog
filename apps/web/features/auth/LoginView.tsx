'use client';

import type { AuthStatusResponse } from '@minidog/types';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorState } from '@/components/observability/States';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import styles from './Login.module.scss';

/**
 * Only pages of this site, so a crafted link cannot send you elsewhere after
 * signing in. Resolved as a URL: browsers read `/\\evil.com` as `//evil.com`.
 */
function safeNext(value: string | null): string {
  if (!value || typeof window === 'undefined') return '/';
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname.startsWith('/login')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function LoginView() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const status = useApi<AuthStatusResponse>('/auth/status', 60_000);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = status.data?.setupRequired ?? false;

  useEffect(() => {
    if (status.data?.signedIn) window.location.replace(next);
  }, [status.data?.signedIn, next]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (setup && password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      // A full load, so every screen starts with the new session.
      window.location.replace(next);
    } catch (failure) {
      const apiError = toApiClientError(failure);
      setError(apiError.validationIssues[0]?.message ?? apiError.message);
      // Set up meanwhile (another tab or person): show the sign-in form now, not after the next poll.
      if (apiError.code === 'already_set_up') status.refetch();
      setBusy(false);
    }
  };

  return (
    <div className={styles.card}>
      <p className={styles.wordmark}>minidog</p>
      {!status.data ? (
        status.error ? (
          <ErrorState title="Unable to reach the Query API." description={status.error.message} onRetry={status.refetch} />
        ) : (
          <Skeleton height="calc(var(--row-height) * 4)" />
        )
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <h1 className={styles.title}>{setup ? 'Set a password' : 'Sign in'}</h1>
          <p className={styles.note}>
            {setup
              ? 'This password protects the dashboard and its API. There is one account, yours; you can change the password in Settings.'
              : 'Enter the dashboard password.'}
          </p>
          <Field id="password" label="Password" hint={setup ? 'At least 8 characters.' : undefined} error={setup ? undefined : (error ?? undefined)}>
            <Input
              id="password"
              type="password"
              autoComplete={setup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              invalid={Boolean(error) && !setup}
            />
          </Field>
          {setup && (
            <Field id="confirm" label="Password again" error={error ?? undefined}>
              <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} invalid={Boolean(error)} />
            </Field>
          )}
          <Button type="submit" variant="primary" loading={busy}>
            {setup ? 'Set password and continue' : 'Sign in'}
          </Button>
          <p className={styles.hint}>
            {setup ? 'Anyone who can open this page before you could set it, so do this now.' : 'Forgot it? Run pnpm auth:reset on the machine running minidog.'}
          </p>
        </form>
      )}
    </div>
  );
}

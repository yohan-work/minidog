'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import type { ApiClientError } from '@/lib/api-client';
import { cx } from '@/lib/cx';
import { formatTime } from '@/lib/format';
import styles from './States.module.scss';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** Every empty state offers the next step. */
  action: ReactNode;
  /** Reserve the chart height so replacing a chart causes no layout shift. */
  fill?: 'chart';
}

export function EmptyState({ title, description, action, fill }: EmptyStateProps) {
  return (
    <div className={cx(styles.state, fill === 'chart' && styles.chart)}>
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      <div className={styles.action}>{action}</div>
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  /** The cause, e.g. "ClickHouse did not respond." */
  description: ReactNode;
  onRetry: () => void;
  fill?: 'chart';
}

export function ErrorState({ title, description, onRetry, fill }: ErrorStateProps) {
  return (
    <div role="alert" className={cx(styles.state, fill === 'chart' && styles.chart)}>
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{description}</p>
      <div className={styles.action}>
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

/** Shown when a refresh failed but earlier data is still on screen. */
export function StaleNotice({
  error,
  updatedAt,
  onRetry,
}: {
  error: ApiClientError | undefined;
  updatedAt: number | undefined;
  onRetry: () => void;
}) {
  if (!error || updatedAt === undefined) return null;
  return (
    <Notice
      tone="warning"
      title="Unable to refresh."
      action={
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {error.message} Showing data from {formatTime(updatedAt)}.
    </Notice>
  );
}

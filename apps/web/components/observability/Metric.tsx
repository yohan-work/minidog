import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import styles from './Metric.module.scss';

export function MetricGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className={styles.grid} aria-label={label}>
      {children}
    </dl>
  );
}

interface MetricProps {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  /** Relative emphasis for values that need attention. */
  tone?: 'warning' | 'error';
  loading?: boolean;
}

export function Metric({ label, value, meta, tone, loading = false }: MetricProps) {
  return (
    <div className={styles.metric}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value} data-tone={tone}>
        {loading ? <Skeleton width="60%" height="var(--text-metric)" /> : value}
      </dd>
      <dd className={styles.meta}>{loading ? <Skeleton width="40%" height="var(--text-meta)" /> : (meta ?? ' ')}</dd>
    </div>
  );
}

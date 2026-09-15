'use client';

import { DEFAULT_TIME_RANGE, TIME_RANGE_KEYS, TIME_RANGES, type ContextResponse, type TimeRange } from '@minidog/types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ChangeEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { apiFetch } from '@/lib/api-client';
import { Skeleton } from '@/components/ui/Skeleton';
import { useApi } from '@/lib/use-api';
import { useTimeRange } from '@/lib/time-range';
import { AlertsIndicator } from './AlertsIndicator';
import { CommandMenuTrigger } from './CommandMenu';
import { ProjectSwitcher } from './ProjectSwitcher';
import styles from './TopBar.module.scss';

export function TopBarFrame({ context, controls }: { context: ReactNode; controls?: ReactNode }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.context}>{context}</div>
      <div className={styles.controls}>{controls}</div>
    </header>
  );
}

export function TopBarFallback() {
  return <TopBarFrame context={<Skeleton width="calc(var(--space-16) * 2)" height="var(--text-ui)" />} />;
}

/** Project · environment context and the shared time range. */
export function TopBar() {
  const range = useTimeRange();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useApi<ContextResponse>('/context', 60_000);

  const onRangeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as TimeRange;
    const params = new URLSearchParams(searchParams);
    // A window selected on a chart gives way to the preset range.
    params.delete('from');
    params.delete('to');
    if (next === DEFAULT_TIME_RANGE) params.delete('range');
    else params.set('range', next);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  return (
    <TopBarFrame
      context={
        data ? (
          <ProjectSwitcher context={data} />
        ) : (
          <Skeleton width="calc(var(--space-16) * 2)" height="var(--text-ui)" />
        )
      }
      controls={
        <>
        <CommandMenuTrigger />
        <AlertsIndicator />
        {data?.auth.enabled && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void apiFetch('/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/login'))}
          >
            Sign out
          </Button>
        )}
        <label className={styles.range}>
          <span className={styles.visuallyHidden}>Time range</span>
          <Select controlSize="sm" value={range} onChange={onRangeChange}>
            {TIME_RANGE_KEYS.map((key) => (
              <option key={key} value={key}>
                {TIME_RANGES[key].label}
              </option>
            ))}
          </Select>
        </label>
        </>
      }
    />
  );
}

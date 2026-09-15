'use client';

import type { DashboardListResponse, DashboardResponse } from '@minidog/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState } from '@/components/observability/States';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHead, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { withRange } from '@/lib/range-href';
import { useTimeRange } from '@/lib/time-range';
import { useApi } from '@/lib/use-api';
import styles from './Dashboards.module.scss';

const COLUMNS = [
  { label: 'Dashboard' },
  { label: 'Widgets', align: 'end' },
  { label: 'Updated', align: 'end', hideBelow: 'tablet' },
] as const satisfies readonly ColumnSpec[];

export function DashboardsView() {
  const range = useTimeRange();
  const list = useApi<DashboardListResponse>('/dashboards', 60_000);

  return (
    <>
      <PageHeader title="Dashboards" meta="Your own screens: the charts you check most, side by side." />
      <Section title="Your dashboards" flush>
        {list.data ? (
          list.data.dashboards.length > 0 ? (
            <Table aria-label="Dashboards">
              <TableHead columns={COLUMNS} />
              <tbody>
                {list.data.dashboards.map((dashboard) => (
                  <Tr key={dashboard.id}>
                    <Td>
                      <Link href={withRange(`/dashboards/${dashboard.id}`, range)}>{dashboard.name}</Link>
                    </Td>
                    <Td align="end" mono>
                      {dashboard.widgetCount}
                    </Td>
                    <Td align="end" mono muted hideBelow="tablet">
                      {formatRelative(Date.parse(dashboard.updatedAt))}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              title="No dashboards yet"
              description="Create one below, then add service, synthetic and metric charts to it — or use Add to dashboard on the Metrics page."
              action={null}
            />
          )
        ) : list.error ? (
          <ErrorState title="Unable to load dashboards." description={list.error.message} onRetry={list.refetch} />
        ) : (
          <Skeleton height="calc(var(--row-height) * 2)" />
        )}
      </Section>
      <Section title="New dashboard">
        <NewDashboardForm />
      </Section>
    </>
  );
}

function NewDashboardForm() {
  const router = useRouter();
  const range = useTimeRange();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { dashboard } = await apiFetch<DashboardResponse>('/dashboards', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      // Opens in edit mode, ready for its first widgets.
      router.push(withRange(`/dashboards/${dashboard.id}?edit=1`, range));
    } catch (failure) {
      const apiError = toApiClientError(failure);
      setError(apiError.validationIssues[0]?.message ?? apiError.message);
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <Field id="dashboard-name" label="Name" error={error ?? undefined}>
        <Input
          id="dashboard-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          placeholder="My site"
          invalid={Boolean(error)}
        />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={saving}>
          Create dashboard
        </Button>
      </div>
    </form>
  );
}

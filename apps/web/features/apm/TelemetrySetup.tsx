'use client';

import type { ContextResponse } from '@minidog/types';
import Link from 'next/link';
import { CodeSnippet } from '@/components/ui/CodeSnippet';
import { useApi } from '@/lib/use-api';
import styles from './Apm.module.scss';

/** Until /context loads; the same default the API reports for a local install. */
const FALLBACK_COLLECTOR_URL = 'http://localhost:4318';

/** Next step for empty APM and log screens: point an OpenTelemetry SDK at the collector. */
export function TelemetrySetup() {
  const { data } = useApi<ContextResponse>('/context', 60_000);
  const collectorUrl = data?.ingest.collectorUrl ?? FALLBACK_COLLECTOR_URL;

  return (
    <div className={styles.setup}>
      <CodeSnippet
        title="Point an OpenTelemetry SDK at the collector"
        code={`OTEL_SERVICE_NAME=checkout\nOTEL_EXPORTER_OTLP_ENDPOINT=${collectorUrl}`}
      />
      <p className={styles.note}>
        Nothing to send yet? Start the sample services with{' '}
        <code className={styles.mono}>docker compose --profile demo up -d</code>, or{' '}
        <code className={styles.mono}>pnpm demo</code> when you run minidog from source. Sending straight to the API, or
        from your own collector: <Link href="/settings">Settings → Connection</Link>.
      </p>
    </div>
  );
}

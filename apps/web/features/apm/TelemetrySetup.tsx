import styles from './Apm.module.scss';

const SNIPPET = `OTEL_SERVICE_NAME=checkout
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`;

/** Next step for empty APM and log screens: point an OpenTelemetry SDK at the collector. */
export function TelemetrySetup() {
  return (
    <div className={styles.setup}>
      <pre className={styles.snippet}>
        <code>{SNIPPET}</code>
      </pre>
      <p className={styles.note}>
        Or run <code className={styles.mono}>pnpm demo</code> for three sample services.
      </p>
    </div>
  );
}

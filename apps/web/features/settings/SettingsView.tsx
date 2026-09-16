'use client';

import {
  API_KEY_HEADER,
  type ApiKeyListResponse,
  type ContextResponse,
  type CreateApiKeyResponse,
  type ProjectInfo,
  type ProjectListResponse,
  RETENTION_DAYS,
  type RetentionSignal,
  type StorageResponse,
  type StorageSignal,
  type SendSummaryResponse,
  type SummaryResponse,
  type SummarySettings,
} from '@minidog/types';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { EmptyState, ErrorState } from '@/components/observability/States';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CodeSnippet, CopyButton } from '@/components/ui/CodeSnippet';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHead, Td, Tr, type ColumnSpec } from '@/components/ui/Table';
import { apiFetch, toApiClientError } from '@/lib/api-client';
import { formatBytes, formatCount, formatDate, formatRelative } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { WebhookTestButton } from '@/features/monitors/WebhookTestButton';
import styles from './Settings.module.scss';

const PROJECT_COLUMNS = [
  { label: 'Project' },
  { label: 'Environments' },
  { label: 'Created', align: 'end', hideBelow: 'tablet' },
] as const satisfies readonly ColumnSpec[];

const STORAGE_COLUMNS = [
  { label: 'Signal' },
  { label: 'Keep for' },
  { label: 'Records', align: 'end' },
  { label: 'On disk', align: 'end' },
  { label: 'Oldest', align: 'end', hideBelow: 'tablet' },
] as const satisfies readonly ColumnSpec[];

const SIGNAL_LABELS: Record<RetentionSignal, string> = {
  traces: 'Traces',
  logs: 'Logs',
  metrics: 'Metrics',
  synthetics: 'Synthetic results',
};

const KEY_COLUMNS = [
  { label: 'Name' },
  { label: 'Environment' },
  { label: 'Key', hideBelow: 'tablet' },
  { label: 'Last used', align: 'end', hideBelow: 'desktop' },
  { label: 'Status', align: 'end' },
] as const satisfies readonly ColumnSpec[];

/** Switching reloads the page so every screen reads the new project and environment. */
async function switchTo(projectId: string, environment: string) {
  await apiFetch('/context', { method: 'PUT', body: JSON.stringify({ projectId, environment }) });
  window.location.reload();
}

export function SettingsView() {
  const projects = useApi<ProjectListResponse>('/projects', 60_000);
  const context = useApi<ContextResponse>('/context', 60_000);
  const active = projects.data?.active;
  const project = projects.data?.projects.find((item) => item.id === active?.projectId);

  if (!projects.data && !projects.isLoading) {
    return (
      <>
        <PageHeader title="Settings" />
        <ErrorState title="Unable to load settings." description={projects.error?.message} onRetry={projects.refetch} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        meta={
          project && active ? (
            <span>
              Showing <strong>{project.name}</strong> / <span className={styles.mono}>{active.environment}</span>
            </span>
          ) : undefined
        }
      />

      <Section title="Projects" flush>
        {projects.data ? (
          <Table aria-label="Projects">
            <TableHead columns={PROJECT_COLUMNS} />
            <tbody>
              {projects.data.projects.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <span className={styles.projectName}>{item.name}</span>
                  </Td>
                  <Td>
                    <span className={styles.environments}>
                      {item.environments.map((environment) => {
                        const current = item.id === active?.projectId && environment.name === active.environment;
                        return current ? (
                          <Badge key={environment.name} mono tone="info">
                            {environment.name} · current
                          </Badge>
                        ) : (
                          <Button
                            key={environment.name}
                            size="sm"
                            variant="ghost"
                            onClick={() => void switchTo(item.id, environment.name)}
                          >
                            <span className={styles.mono}>{environment.name}</span>
                          </Button>
                        );
                      })}
                    </span>
                  </Td>
                  <Td align="end" mono muted hideBelow="tablet">
                    {formatDate(Date.parse(item.createdAt))}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Skeleton height="calc(var(--row-height) * 2)" />
        )}
      </Section>

      <Section title="New project">
        <NewProjectForm onCreated={projects.refetch} />
      </Section>

      {project && (
        <Section title={`Environments of ${project.name}`}>
          <NewEnvironmentForm project={project} onCreated={projects.refetch} />
        </Section>
      )}

      {project && <ApiKeysSection project={project} />}

      <Section title="Connection">
        {context.data ? <ConnectionInfo context={context.data} /> : <Skeleton height="calc(var(--row-height) * 4)" />}
      </Section>

      <StorageSection />

      <SummarySection />

      {context.data?.auth.enabled && (
        <Section title="Password">
          <PasswordForm />
        </Section>
      )}
    </>
  );
}

function useFormErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const capture = (failure: unknown) => {
    const apiError = toApiClientError(failure);
    const next: Record<string, string> = {};
    for (const issue of apiError.validationIssues) next[issue.path] ??= issue.message;
    setErrors(Object.keys(next).length > 0 ? next : { form: apiError.message });
  };
  return { errors, setErrors, capture };
}

function NewProjectForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState('production');
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, capture } = useFormErrors();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name, environment }) });
      setName('');
      onCreated();
    } catch (failure) {
      capture(failure);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <Field id="project-name" label="Name" error={errors.name}>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          invalid={Boolean(errors.name)}
        />
      </Field>
      <Field id="project-environment" label="First environment" error={errors.environment}>
        <Input
          id="project-environment"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value)}
          mono
          invalid={Boolean(errors.environment)}
        />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" loading={saving}>
          Create project
        </Button>
        {errors.form && <span className={styles.error}>{errors.form}</span>}
      </div>
    </form>
  );
}

function NewEnvironmentForm({ project, onCreated }: { project: ProjectInfo; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, capture } = useFormErrors();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await apiFetch(`/projects/${project.id}/environments`, { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      onCreated();
    } catch (failure) {
      capture(failure);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <p className={`${styles.full} ${styles.note}`}>
        {project.environments.map((environment) => environment.name).join(', ')}. Telemetry names its environment with
        the <code className={styles.mono}>deployment.environment.name</code> resource attribute or through an API key.
      </p>
      <Field id="environment-name" label="New environment" error={errors.name}>
        <Input
          id="environment-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          mono
          placeholder="staging"
          invalid={Boolean(errors.name)}
        />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" loading={saving}>
          Add environment
        </Button>
        {errors.form && <span className={styles.error}>{errors.form}</span>}
      </div>
    </form>
  );
}

function ApiKeysSection({ project }: { project: ProjectInfo }) {
  const keys = useApi<ApiKeyListResponse>(`/projects/${project.id}/api-keys`, 60_000);
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState(project.environments[0]?.name ?? 'production');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const { errors, setErrors, capture } = useFormErrors();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      setCreated(
        await apiFetch<CreateApiKeyResponse>(`/projects/${project.id}/api-keys`, {
          method: 'POST',
          body: JSON.stringify({ name, environment }),
        }),
      );
      setName('');
      keys.refetch();
    } catch (failure) {
      capture(failure);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await apiFetch(`/projects/${project.id}/api-keys/${id}`, { method: 'DELETE' });
      keys.refetch();
    } catch (failure) {
      capture(failure);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Section title="API keys">
      <p className={styles.note}>
        A key sends telemetry into one environment of <strong>{project.name}</strong>. Send it in the{' '}
        <code className={styles.mono}>{API_KEY_HEADER}</code> header.
      </p>

      {created && (
        <div className={styles.secret}>
          <Notice
            tone="info"
            title={`Key "${created.apiKey.name}" created.`}
            action={<CopyButton value={created.secret} />}
          >
            Copy it now — it is not stored and cannot be shown again.
          </Notice>
          <pre className={styles.snippet}>
            <code>{created.secret}</code>
          </pre>
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field id="key-name" label="Name" error={errors.name}>
          <Input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="collector on web-1"
            maxLength={100}
            invalid={Boolean(errors.name)}
          />
        </Field>
        <Field id="key-environment" label="Environment" error={errors.environment}>
          <Select id="key-environment" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
            {project.environments.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={saving}>
            Create API key
          </Button>
          {errors.form && <span className={styles.error}>{errors.form}</span>}
        </div>
      </form>

      <div className={styles.flushTable}>
        {keys.data ? (
          keys.data.apiKeys.length > 0 ? (
            <Table aria-label="API keys">
              <TableHead columns={KEY_COLUMNS} />
              <tbody>
                {keys.data.apiKeys.map((key) => (
                  <Tr key={key.id}>
                    <Td>{key.name}</Td>
                    <Td mono>{key.environment}</Td>
                    <Td mono muted hideBelow="tablet">
                      {key.prefix}…
                    </Td>
                    <Td align="end" mono muted hideBelow="desktop">
                      {key.lastUsedAt ? formatRelative(Date.parse(key.lastUsedAt)) : 'never'}
                    </Td>
                    <Td align="end">
                      {key.revokedAt ? (
                        <span className={styles.note}>Revoked {formatDate(Date.parse(key.revokedAt))}</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          loading={revoking === key.id}
                          onClick={() => void revoke(key.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              title="No API keys yet"
              description="Without a key, telemetry goes to the default project. Create a key per collector or service."
              action={null}
            />
          )
        ) : keys.error ? (
          <ErrorState title="Unable to load API keys." description={keys.error.message} onRetry={keys.refetch} />
        ) : (
          <Skeleton height="calc(var(--row-height) * 2)" />
        )}
      </div>
    </Section>
  );
}

/** Disk use per signal and how long each is kept (ClickHouse TTL, shared by every project). */
function StorageSection() {
  const storage = useApi<StorageResponse>('/storage', 60_000);
  const [saving, setSaving] = useState<RetentionSignal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (item: StorageSignal, days: number) => {
    const label = SIGNAL_LABELS[item.signal].toLowerCase();
    // An unknown current value may be longer, so it asks too.
    const shorter = item.retentionDays === null || days < item.retentionDays;
    if (shorter && !window.confirm(`Keep ${label} for ${days} days? Older ${label} are deleted now, in every project.`))
      return;
    setSaving(item.signal);
    setError(null);
    try {
      await apiFetch<StorageResponse>('/storage/retention', {
        method: 'PUT',
        body: JSON.stringify({ signal: item.signal, days }),
      });
      storage.refetch();
    } catch (failure) {
      setError(toApiClientError(failure).message);
    } finally {
      setSaving(null);
    }
  };

  const data = storage.data;
  const total = data ? data.signals.reduce((sum, item) => sum + item.bytes, 0) + data.sqliteBytes : 0;

  return (
    <Section title="Storage">
      <p className={styles.note}>
        {data ? (
          <>
            minidog uses <strong>{formatBytes(total)}</strong> on this machine, including{' '}
            {formatBytes(data.sqliteBytes)} of settings.{' '}
          </>
        ) : null}
        Retention applies to every project; shortening it deletes older records right away.
        {error && <span className={styles.error}> {error}</span>}
      </p>
      <div className={styles.flushTable}>
        {data ? (
          <Table aria-label="Storage">
            <TableHead columns={STORAGE_COLUMNS} />
            <tbody>
              {data.signals.map((item) => (
                <Tr key={item.signal}>
                  <Td>{SIGNAL_LABELS[item.signal]}</Td>
                  <Td>
                    <Select
                      aria-label={`Keep ${SIGNAL_LABELS[item.signal].toLowerCase()} for`}
                      value={item.retentionDays === null ? '' : String(item.retentionDays)}
                      disabled={saving !== null}
                      onChange={(event) => void change(item, Number(event.target.value))}
                    >
                      {item.retentionDays === null && <option value="">Not set</option>}
                      {item.retentionDays !== null &&
                        !(RETENTION_DAYS as readonly number[]).includes(item.retentionDays) && (
                          <option value={item.retentionDays}>{item.retentionDays} days</option>
                        )}
                      {RETENTION_DAYS.map((days) => (
                        <option key={days} value={days}>
                          {days === 365 ? '1 year' : `${days} days`}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td align="end" mono>
                    {formatCount(item.rows)}
                  </Td>
                  <Td align="end" mono>
                    {formatBytes(item.bytes)}
                  </Td>
                  <Td align="end" mono muted hideBelow="tablet">
                    {item.oldest === null ? '—' : formatDate(item.oldest)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : storage.error ? (
          <ErrorState title="Unable to read storage." description={storage.error.message} onRetry={storage.refetch} />
        ) : (
          <Skeleton height="calc(var(--row-height) * 4)" />
        )}
      </div>
    </Section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function SummarySection() {
  const summary = useApi<SummaryResponse>('/summary', 60_000);
  return (
    <Section title="Daily summary">
      {summary.data ? (
        <SummaryForm data={summary.data} onSaved={summary.refetch} />
      ) : summary.error ? (
        <ErrorState
          title="Unable to load summary settings."
          description={summary.error.message}
          onRetry={summary.refetch}
        />
      ) : (
        <Skeleton height="calc(var(--row-height) * 4)" />
      )}
    </Section>
  );
}

/** A short daily report to a phone or chat, sent at a chosen hour in this browser's time zone. */
function SummaryForm({ data, onSaved }: { data: SummaryResponse; onSaved: () => void }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [values, setValues] = useState<SummarySettings>(data.settings);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { errors, setErrors, capture } = useFormErrors();

  const update = (patch: Partial<SummarySettings>) => {
    setValues((current) => ({ ...current, ...patch }));
    setResult(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await apiFetch<SummaryResponse>('/summary', {
        method: 'PUT',
        body: JSON.stringify({ ...values, webhookUrl: values.webhookUrl.trim(), timeZone }),
      });
      setResult('Saved.');
      onSaved();
    } catch (failure) {
      capture(failure);
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    setErrors({});
    try {
      // The URL in the field, like Send test, even before it is saved.
      const { status } = await apiFetch<SendSummaryResponse>('/summary/send', {
        method: 'POST',
        body: JSON.stringify({ days: 1, webhookUrl: values.webhookUrl.trim() }),
      });
      setResult(`Sent now · ${status}`);
    } catch (failure) {
      capture(failure);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <p className={styles.note}>
        Uptime, response time and certificates of each synthetic monitor, alert changes and time not measured, once a
        day at the chosen hour ({timeZone}). If this computer was off or asleep then, it goes out when minidog runs
        again.
      </p>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <label className={`${styles.full} ${styles.checkbox}`}>
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <span>Send a daily summary</span>
        </label>
        <div className={styles.full}>
          <Field
            id="summary-webhook"
            label="Webhook URL"
            hint="Slack, Discord, Telegram and ntfy.sh URLs get their own format."
            error={errors.webhookUrl}
          >
            <Input
              id="summary-webhook"
              value={values.webhookUrl}
              onChange={(event) => update({ webhookUrl: event.target.value })}
              type="url"
              mono
              placeholder="https://ntfy.sh/your-topic"
              invalid={Boolean(errors.webhookUrl)}
            />
            <WebhookTestButton url={values.webhookUrl} />
          </Field>
        </div>
        <Field id="summary-hour" label="Send from">
          <Select
            id="summary-hour"
            value={String(values.hour)}
            onChange={(event) => update({ hour: Number(event.target.value) })}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {`${String(hour).padStart(2, '0')}:00`}
              </option>
            ))}
          </Select>
        </Field>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={values.weekly}
            onChange={(event) => update({ weekly: event.target.checked })}
          />
          <span>On Mondays, cover the last 7 days</span>
        </label>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={saving}>
            Save
          </Button>
          <Button type="button" loading={sending} disabled={!values.webhookUrl.trim()} onClick={() => void sendNow()}>
            Send now
          </Button>
          {result && (
            <span role="status" className={result.includes('failed') ? styles.error : styles.note}>
              {result}
            </span>
          )}
          {errors.form && <span className={styles.error}>{errors.form}</span>}
        </div>
      </form>
      <p className={styles.note}>
        {data.lastFailedAt ? (
          <span className={styles.error}>
            Last attempt {formatRelative(Date.parse(data.lastFailedAt))} failed ({data.lastStatus}); it is retried every
            10 minutes.
          </span>
        ) : data.lastSentAt ? (
          `Last scheduled summary ${formatRelative(Date.parse(data.lastSentAt))} · ${data.lastStatus}`
        ) : (
          'No scheduled summary sent yet.'
        )}
      </p>
      <div className={styles.snippetBlock}>
        <div className={styles.snippetHead}>
          <span className={styles.snippetTitle}>Preview (last 24 h)</span>
        </div>
        <pre className={styles.snippet}>
          <code>{data.preview}</code>
        </pre>
      </div>
    </>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const { errors, setErrors, capture } = useFormErrors();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setDone(false);
    try {
      await apiFetch('/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) });
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (failure) {
      capture(failure);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <Field id="password-current" label="Current password" error={errors.current}>
        <Input
          id="password-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          invalid={Boolean(errors.current)}
        />
      </Field>
      <Field id="password-next" label="New password" hint="At least 8 characters." error={errors.next}>
        <Input
          id="password-next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          invalid={Boolean(errors.next)}
        />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" loading={saving}>
          Change password
        </Button>
        {done && (
          <span role="status" className={styles.note}>
            Changed. Other browsers were signed out.
          </span>
        )}
        {errors.form && <span className={styles.error}>{errors.form}</span>}
      </div>
    </form>
  );
}

function ConnectionInfo({ context }: { context: ContextResponse }) {
  const { apiUrl, collectorUrl, requireApiKey } = context.ingest;
  const sdk = `OTEL_SERVICE_NAME=checkout
OTEL_EXPORTER_OTLP_ENDPOINT=${collectorUrl}`;
  const direct = `OTEL_EXPORTER_OTLP_ENDPOINT=${apiUrl}
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_HEADERS=${API_KEY_HEADER}=<api key>`;
  const collector = `exporters:
  otlp_http/minidog:
    endpoint: ${apiUrl}
    encoding: json
    headers:
      ${API_KEY_HEADER}: <api key>`;

  return (
    <div className={styles.connection}>
      <p className={styles.note}>
        {requireApiKey
          ? 'This server requires an API key on every OTLP request.'
          : 'Requests without an API key are stored in the default project.'}
      </p>
      <CodeSnippet title="SDK → bundled collector" code={sdk} />
      <CodeSnippet title="SDK → Ingestion API directly (OTLP/HTTP JSON)" code={direct} />
      <CodeSnippet title="Your own collector" code={collector} />
      <p className={styles.note}>
        The bundled collector reads the key from <code className={styles.mono}>MINIDOG_API_KEY</code>:{' '}
        <code className={styles.mono}>MINIDOG_API_KEY=&lt;api key&gt; pnpm infra:up</code>
      </p>
    </div>
  );
}

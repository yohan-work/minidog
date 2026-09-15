'use client';

import type { ContextResponse, ProjectListResponse } from '@minidog/types';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { apiFetch } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import styles from './TopBar.module.scss';

/**
 * Project / environment context. With more than one choice it becomes a
 * select; switching reloads so every screen reads the new scope.
 */
export function ProjectSwitcher({ context }: { context: ContextResponse }) {
  const projects = useApi<ProjectListResponse>('/projects', 60_000);
  const [switching, setSwitching] = useState(false);
  const choices =
    projects.data?.projects.flatMap((project) =>
      project.environments.map((environment) => ({
        value: `${project.id}|${environment.name}`,
        label: `${project.name} / ${environment.name}`,
      })),
    ) ?? [];

  if (choices.length <= 1) {
    return (
      <>
        <span className={styles.project}>{context.project.name}</span>
        <span className={styles.separator} aria-hidden>
          /
        </span>
        <Badge mono>{context.environment}</Badge>
      </>
    );
  }

  const onChange = async (value: string) => {
    const [projectId, environment] = value.split('|');
    setSwitching(true);
    try {
      await apiFetch('/context', { method: 'PUT', body: JSON.stringify({ projectId, environment }) });
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  };

  return (
    <label className={styles.switcher}>
      <span className={styles.visuallyHidden}>Project and environment</span>
      <Select
        controlSize="sm"
        value={`${context.project.id}|${context.environment}`}
        onChange={(event) => void onChange(event.target.value)}
        disabled={switching}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

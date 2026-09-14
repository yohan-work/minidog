import type { ReactNode } from 'react';
import styles from './Field.module.scss';

interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

/** Ids the control should reference via `aria-describedby`. */
export function fieldDescription(id: string, { hint, error }: { hint?: ReactNode; error?: string }) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className={styles.error}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
